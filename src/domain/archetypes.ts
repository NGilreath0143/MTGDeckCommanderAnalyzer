import { cardTypes, isLand } from './cardFacts';
import { classifyCardRoles } from './roles';
import { classifyCardTags } from './tags';
import {
  ARCHETYPE_INFERENCE_TYPES,
  type ArchetypeEvidenceItem,
  type ArchetypeInference,
  type ArchetypeInferenceType,
  type CardTag,
  type DeckArchetypeProfile,
  type DeckComposition,
  type DeckStrategyProfile,
  type InferenceConfidence,
  type InferenceKind,
  type ResolvedCard,
  type StrategySignalType,
} from './types';

/**
 * Deterministic archetype and theme inference. Pure: no I/O, no LLM, no power
 * scoring, no recommendations.
 *
 * Reads the Phase 3A tags, Phase 2 roles, Phase 3B signals, and a small amount
 * of contextual card-type density, and decides which recognizable Commander
 * plans a deck is actually pursuing.
 *
 * Three principles run through every definition:
 *
 *  1. ANCHORS GATE. Each inference names required evidence. If the anchor is
 *     absent the score is 0 and no amount of supporting evidence revives it.
 *     This is what stops 16 utility artifacts from becoming an Artifacts deck.
 *  2. CONTEXTUAL DENSITY ONLY AFTER INTENT. Raw card-type counts contribute
 *     nothing until the anchor passes, so 42 instants and sorceries with no
 *     payoff never make a Spellslinger.
 *  3. THE COMMANDER IS NOT AN ORDINARY CARD. Commander evidence is scored
 *     separately and can satisfy weaker anchor paths, because a commander
 *     often IS the engine.
 */

// ---------------------------------------------------------------------------
// Scoring primitives
// ---------------------------------------------------------------------------

/** Diminishing returns, matching the Phase 3B shape for consistency. */
function ramp(count: number, max: number, scale: number): number {
  if (count <= 0) return 0;
  return Math.min(max, max * (1 - Math.exp(-count / scale)));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Initial bands, mirroring Phase 3B. Explicitly uncalibrated. */
export function confidenceFor(score: number): InferenceConfidence {
  if (score < 30) return 'weak';
  if (score < 50) return 'possible';
  if (score < 70) return 'likely';
  return 'defining';
}

// ---------------------------------------------------------------------------
// Evidence gathering — one pass over the composition
// ---------------------------------------------------------------------------

/**
 * A generator of CREATURE tokens specifically.
 *
 * Phase 3A's `token_generation` covers Treasure, Clue and Food too: measured
 * across the Commander-legal corpus, 547 of 3123 tagged cards make only
 * noncreature tokens. Go-Wide needs bodies, so it reads this instead.
 */
const CREATURE_TOKEN_TEXT =
  /\bcreates?\b[^.]{0,80}?\bcreature tokens?\b|\bcreates?\b[^.]{0,60}?\b\d+\/\d+\b/i;

/**
 * Counter text that is only about planeswalker loyalty. Ordinary loyalty
 * counters must not establish the Counters theme.
 */
const LOYALTY_ONLY = /\bloyalty counters?\b/i;

/**
 * Phase 3C-specific reanimation discriminator.
 *
 * Phase 3A's `reanimation` tag is deliberately broad: it fires on land
 * recursion (Crucible, Titania, Life from the Loam) as well as creature
 * reanimation. Reanimator as an ARCHETYPE is narrower, so this recognises
 * returning NONLAND resources for reuse. Phase 3A semantics are unchanged.
 */
const NONLAND_REANIMATION: RegExp[] = [
  // "return target creature/permanent card ... from your graveyard to the battlefield"
  /\b(?:creature|permanent|artifact|enchantment)\s+cards?\b[^.]{0,60}?\bfrom (?:a|your|their) graveyard\b[^.]{0,40}?\b(?:to|onto) the battlefield\b/i,
  /\bput target (?:creature|permanent)\s+card from a graveyard onto the battlefield\b/i,
  // Animate Dead's aura template.
  /\benchant creature card in a graveyard\b/i,
  // Mass reanimation (Living Death).
  /\bcreature cards? from their graveyard\b[^.]{0,120}?\bonto the battlefield\b/i,
  // Recastable-from-graveyard engines.
  /\bnonland cards? in your graveyard\b[^.]{0,40}?\bescape\b/i,
  /\bcards? in your graveyard (?:has|have) (?:escape|flashback)\b/i,
  // Card-to-hand retrieval (Regrowth, Eternal Witness) is nonland reuse.
  /\breturn\b[^.]{0,50}?\bcard from your graveyard to your hand\b/i,
];

/** True when a card reanimates nonland resources, not merely lands. */
function isNonlandReanimation(card: ResolvedCard): boolean {
  const text = frontText(card);
  return NONLAND_REANIMATION.some((re) => re.test(text));
}

function frontText(card: ResolvedCard): string {
  return (card.oracleText.replace(/\([^()]*\)/g, ' ').split('\n//\n')[0] ?? '').trim();
}

interface DeckEvidence {
  /** Quantity-weighted tag counts across the whole deck, commanders included. */
  tag: (tag: CardTag) => number;
  /** Quantity-weighted tag counts for commanders only. */
  commanderTag: (tag: CardTag) => number;
  /** Quantity-weighted mainboard card-type counts. */
  type: (type: 'Planeswalker' | 'Artifact' | 'Enchantment' | 'Instant' | 'Sorcery' | 'Creature') => number;
  /** Instants plus sorceries in the mainboard. */
  spellDensity: number;
  /** Mainboard lands. */
  landCount: number;
  /** Quantity-weighted Phase 2 `ramp` role count in the mainboard. */
  rampCount: number;
  /** Token generators that specifically make creature tokens. */
  creatureTokenGenerators: number;
  /** Counter-relevant cards whose only counter text is loyalty. */
  loyaltyOnlyCounterCards: number;
  /** Reanimation cards that return NONLAND resources (Phase 3C narrower). */
  nonlandReanimation: number;
  /** Commander-only nonland reanimation. */
  commanderNonlandReanimation: number;
  /** Phase 3B signal score by family, 0 when absent. */
  signal: (strategy: StrategySignalType) => number;
  mainboardSize: number;
}

function gatherEvidence(
  composition: DeckComposition,
  strategy: DeckStrategyProfile,
): DeckEvidence {
  interface Slot {
    card: ResolvedCard;
    quantity: number;
    isCommander: boolean;
    tags: Set<CardTag>;
  }

  const slots: Slot[] = [
    ...composition.commanders.map((card) => ({
      card,
      quantity: 1,
      isCommander: true,
      tags: new Set(classifyCardTags(card).assignments.map((a) => a.tag)),
    })),
    ...composition.mainboard.map(({ card, quantity }) => ({
      card,
      quantity,
      isCommander: false,
      tags: new Set(classifyCardTags(card).assignments.map((a) => a.tag)),
    })),
  ];

  const mainboard = slots.filter((s) => !s.isCommander);
  const sum = (list: Slot[], predicate: (s: Slot) => boolean) =>
    list.filter(predicate).reduce((total, s) => total + s.quantity, 0);

  const COUNTER_TAGS: CardTag[] = [
    'counter_generation',
    'counter_payoff',
    'counter_doubling',
    'plus_one_counters',
  ];

  const signals = new Map(strategy.signals.map((s) => [s.strategy, s.score]));

  return {
    tag: (tag) => sum(slots, (s) => s.tags.has(tag)),
    commanderTag: (tag) => sum(slots, (s) => s.isCommander && s.tags.has(tag)),
    type: (type) => sum(mainboard, (s) => cardTypes(s.card.typeLine).includes(type)),
    spellDensity:
      sum(mainboard, (s) => cardTypes(s.card.typeLine).includes('Instant')) +
      sum(mainboard, (s) => cardTypes(s.card.typeLine).includes('Sorcery')),
    landCount: sum(mainboard, (s) => isLand(s.card)),
    rampCount: sum(
      mainboard,
      (s) => classifyCardRoles(s.card).assignments.some((a) => a.role === 'ramp'),
    ),
    creatureTokenGenerators: sum(
      slots,
      (s) => s.tags.has('token_generation') && CREATURE_TOKEN_TEXT.test(frontText(s.card)),
    ),
    loyaltyOnlyCounterCards: sum(
      slots,
      (s) =>
        COUNTER_TAGS.some((t) => s.tags.has(t)) &&
        LOYALTY_ONLY.test(frontText(s.card)) &&
        !/\+1\/\+1 counters?/i.test(frontText(s.card)),
    ),
    nonlandReanimation: sum(
      slots,
      (s) => s.tags.has('reanimation') && isNonlandReanimation(s.card),
    ),
    commanderNonlandReanimation: sum(
      slots,
      (s) => s.isCommander && s.tags.has('reanimation') && isNonlandReanimation(s.card),
    ),
    signal: (strategyType) => signals.get(strategyType) ?? 0,
    mainboardSize: mainboard.reduce((total, s) => total + s.quantity, 0),
  };
}

// ---------------------------------------------------------------------------
// Definition shape
// ---------------------------------------------------------------------------

interface AnchorResult {
  satisfied: boolean;
  /** Points awarded when satisfied. */
  score: number;
  evidence: ArchetypeEvidenceItem[];
}

interface ScoredComponent {
  score: number;
  evidence: ArchetypeEvidenceItem[];
}

interface InferenceDefinition {
  archetype: ArchetypeInferenceType;
  kind: InferenceKind;
  parent?: ArchetypeInferenceType;
  anchor(e: DeckEvidence, context: InferenceContext): AnchorResult;
  engine(e: DeckEvidence): ScoredComponent;
  support(e: DeckEvidence): ScoredComponent;
  commander(e: DeckEvidence): ScoredComponent;
  /** Contextual card-type density. Only invoked when the anchor passed. */
  density(e: DeckEvidence): ScoredComponent;
}

/** Results of earlier inferences, for specializations like Aura Voltron. */
interface InferenceContext {
  resolved: Map<ArchetypeInferenceType, ArchetypeInference>;
}

const item = (
  id: string,
  description: string,
  value?: number | string | boolean,
  contribution?: number,
): ArchetypeEvidenceItem => ({ id, description, value, contribution });

// ---------------------------------------------------------------------------
// The 14 inferences
// ---------------------------------------------------------------------------

const DEFINITIONS: InferenceDefinition[] = [
  // === Aristocrats =======================================================
  {
    archetype: 'aristocrats',
    kind: 'archetype',
    anchor: (e) => {
      const outlets = e.tag('sacrifice_outlet');
      const payoffs = e.tag('death_payoff') + e.tag('sacrifice_payoff');
      // Fodder may be tokens, dedicated fodder, or recursive creatures.
      const fodder =
        e.creatureTokenGenerators + e.tag('sacrifice_fodder') + e.tag('reanimation');
      const satisfied = outlets >= 2 && payoffs >= 2 && fodder >= 3;
      return {
        satisfied,
        score: 30,
        evidence: [
          item('anchor.outlets', 'sacrifice outlets (need 2+)', outlets),
          item('anchor.payoffs', 'death + sacrifice payoffs (need 2+)', payoffs),
          item('anchor.fodder', 'renewable fodder (need 3+)', fodder),
          item('anchor.satisfied', 'repeatable sacrifice engine present', satisfied),
        ],
      };
    },
    engine: (e) => {
      // The engine is the weakest link of outlet / payoff / fodder.
      const outlets = e.tag('sacrifice_outlet');
      const payoffs = e.tag('death_payoff') + e.tag('sacrifice_payoff');
      const fodder = e.creatureTokenGenerators + e.tag('sacrifice_fodder') + e.tag('reanimation');
      const weakest = Math.min(outlets, payoffs, fodder);
      const score = ramp(weakest, 25, 4);
      return {
        score,
        evidence: [item('engine.weakestLink', 'weakest of outlet/payoff/fodder', weakest, round2(score))],
      };
    },
    support: (e) => {
      const score = ramp(e.tag('sacrifice_fodder') + e.tag('reanimation'), 15, 6);
      return {
        score,
        evidence: [
          item('support.fodderDepth', 'dedicated fodder + recursion', e.tag('sacrifice_fodder') + e.tag('reanimation'), round2(score)),
        ],
      };
    },
    commander: (e) => {
      const relevant =
        e.commanderTag('sacrifice_outlet') +
        e.commanderTag('death_payoff') +
        e.commanderTag('sacrifice_payoff');
      const score = relevant > 0 ? 15 : 0;
      return { score, evidence: [item('commander.engine', 'commander supplies outlet or payoff', relevant > 0, score)] };
    },
    density: (e) => {
      const score = ramp(e.type('Creature'), 15, 14);
      return { score, evidence: [item('density.creatures', 'creature bodies to sacrifice', e.type('Creature'), round2(score))] };
    },
  },

  // === Reanimator ========================================================
  {
    archetype: 'reanimator',
    kind: 'archetype',
    anchor: (e) => {
      const broad = e.tag('reanimation');
      const nonland = e.nonlandReanimation;
      /*
       * Only NONLAND reanimation anchors the archetype. Phase 3A's tag also
       * covers land recursion (Crucible, Titania, Life from the Loam), which
       * belongs to the Lands theme; broad graveyard value may support
       * Reanimator but must not establish it.
       */
      const satisfied = nonland >= 3;
      return {
        satisfied,
        score: 30,
        evidence: [
          item('anchor.reanimationTagged', 'Phase 3A reanimation effects (broad)', broad),
          item('anchor.nonlandReanimation', 'nonland reanimation (need 3+)', nonland),
          item('anchor.landOnlyExcluded', 'land-recursion-only effects excluded', broad - nonland),
          item('anchor.satisfied', 'creature/nonland reanimation present', satisfied),
        ],
      };
    },
    engine: (e) => {
      // Filling the graveyard on purpose is what separates a plan from value.
      const enablers = e.tag('graveyard_filling') + e.tag('self_mill');
      const score = ramp(Math.min(e.nonlandReanimation, enablers), 25, 3);
      return {
        score,
        evidence: [
          item('engine.enablers', 'graveyard filling + self mill', enablers, round2(score)),
        ],
      };
    },
    support: (e) => {
      const score = ramp(e.nonlandReanimation, 15, 6);
      return { score, evidence: [item('support.reanimationDepth', 'nonland reanimation density', e.nonlandReanimation, round2(score))] };
    },
    commander: (e) => {
      /*
       * A commander only counts as a Reanimator engine when it returns nonland
       * resources. Titania returns land cards, so she supports the Lands theme
       * rather than anchoring Reanimator here.
       */
      const engine = e.commanderNonlandReanimation > 0;
      const score = engine ? 15 : 0;
      return {
        score,
        evidence: [
          item('commander.engine', 'commander reanimates nonland resources', engine, score),
          item('commander.landOnly', 'commander recursion is land-only', e.commanderTag('reanimation') > 0 && !engine),
        ],
      };
    },
    density: (e) => {
      const score = ramp(e.tag('graveyard_payoff'), 15, 4);
      return { score, evidence: [item('density.graveyardPayoff', 'graveyard payoff support', e.tag('graveyard_payoff'), round2(score))] };
    },
  },

  // === Superfriends ======================================================
  {
    archetype: 'superfriends',
    kind: 'archetype',
    anchor: (e) => {
      const planeswalkers = e.type('Planeswalker');
      // Actual planeswalker density is the anchor: tags alone are not enough.
      const satisfied = planeswalkers >= 5;
      return {
        satisfied,
        score: 35,
        evidence: [
          item('anchor.planeswalkerCards', 'actual planeswalker cards (need 5+)', planeswalkers),
          item('anchor.satisfied', 'planeswalker density present', satisfied),
        ],
      };
    },
    engine: (e) => {
      const support =
        e.tag('planeswalker_payoff') +
        e.tag('planeswalker_generation') +
        e.tag('planeswalker_doubling');
      const score = ramp(support, 20, 4);
      return { score, evidence: [item('engine.planeswalkerSupport', 'planeswalker payoff/generation/doubling', support, round2(score))] };
    },
    support: (e) => {
      // Proliferate adds loyalty, so it is genuine Superfriends support.
      const score = ramp(e.tag('proliferate'), 15, 4);
      return { score, evidence: [item('support.proliferate', 'proliferate effects', e.tag('proliferate'), round2(score))] };
    },
    commander: (e) => {
      const relevant =
        e.commanderTag('planeswalker_payoff') +
        e.commanderTag('planeswalker_generation') +
        e.commanderTag('planeswalker_doubling') +
        e.commanderTag('proliferate');
      const score = relevant > 0 ? 15 : 0;
      return { score, evidence: [item('commander.support', 'commander supports planeswalkers', relevant > 0, score)] };
    },
    density: (e) => {
      const score = ramp(e.type('Planeswalker'), 15, 10);
      return { score, evidence: [item('density.planeswalkers', 'planeswalker count', e.type('Planeswalker'), round2(score))] };
    },
  },

  // === Spellslinger ======================================================
  {
    archetype: 'spellslinger',
    kind: 'archetype',
    anchor: (e) => {
      const payoff = e.tag('spell_payoff');
      const copy = e.tag('spell_copy');
      const commanderEngine =
        e.commanderTag('spell_payoff') + e.commanderTag('spell_copy') > 0;
      /*
       * Payoff or copy evidence must combine with real spell infrastructure.
       * Raw instant/sorcery density can never establish this on its own, and a
       * couple of incidental payoffs in a deck with few spells is not a plan.
       * A commander that IS a repeatable spell engine relaxes the density need.
       */
      const infrastructure =
        e.tag('spell_copy') + e.tag('spell_cost_reduction') + e.tag('spell_recursion');
      /*
       * Raw instant/sorcery density may STRENGTHEN a spell engine but never
       * substitutes for one. Four explicit paths:
       *   a) several payoffs on their own
       *   b) payoffs plus any copy/reduction/recursion infrastructure
       *   c) a copy-heavy engine with real spell density
       *   d) a commander that is itself a repeatable engine, with support
       */
      const pathManyPayoffs = payoff >= 3;
      const pathPayoffWithInfrastructure = payoff >= 2 && infrastructure >= 1;
      const pathCopyEngine = copy >= 3 && e.spellDensity >= 12;
      const pathCommanderEngine = commanderEngine && e.spellDensity >= 8;
      const satisfied =
        pathManyPayoffs ||
        pathPayoffWithInfrastructure ||
        pathCopyEngine ||
        pathCommanderEngine;
      return {
        satisfied,
        score: 30,
        evidence: [
          item('anchor.spellPayoff', 'spell payoff effects', payoff),
          item('anchor.spellCopy', 'spell copy effects', copy),
          item('anchor.spellInfrastructure', 'copy + reduction + recursion', infrastructure),
          item('anchor.spellDensity', 'instants + sorceries', e.spellDensity),
          item('anchor.commanderEngine', 'commander is a spell engine', commanderEngine),
          item('anchor.pathManyPayoffs', 'path a: 3+ payoffs', pathManyPayoffs),
          item('anchor.pathPayoffWithInfrastructure', 'path b: 2+ payoffs with infrastructure', pathPayoffWithInfrastructure),
          item('anchor.pathCopyEngine', 'path c: copy engine with density', pathCopyEngine),
          item('anchor.pathCommanderEngine', 'path d: commander engine with density', pathCommanderEngine),
          item('anchor.satisfied', 'spell engine present', satisfied),
        ],
      };
    },
    engine: (e) => {
      const infra =
        e.tag('spell_copy') + e.tag('spell_cost_reduction') + e.tag('spell_recursion');
      const score = ramp(Math.min(e.tag('spell_payoff') + e.tag('spell_copy'), infra + 1), 25, 3);
      return { score, evidence: [item('engine.spellInfrastructure', 'copy + reduction + recursion', infra, round2(score))] };
    },
    support: (e) => {
      const score = ramp(e.tag('spell_payoff'), 15, 4);
      return { score, evidence: [item('support.payoffDepth', 'spell payoff density', e.tag('spell_payoff'), round2(score))] };
    },
    commander: (e) => {
      const relevant =
        e.commanderTag('spell_payoff') +
        e.commanderTag('spell_copy') +
        e.commanderTag('spell_cost_reduction');
      const score = relevant > 0 ? 15 : 0;
      return { score, evidence: [item('commander.engine', 'commander rewards spellcasting', relevant > 0, score)] };
    },
    density: (e) => {
      const score = ramp(e.spellDensity, 15, 20);
      return { score, evidence: [item('density.spells', 'instant + sorcery count', e.spellDensity, round2(score))] };
    },
  },

  // === Voltron ===========================================================
  {
    archetype: 'voltron',
    kind: 'archetype',
    anchor: (e) => {
      const voltron = e.tag('voltron');
      const commanderVoltron = e.commanderTag('voltron') > 0;
      // Generic protection must never manufacture Voltron: the anchor is the
      // voltron tag itself, or a commander that concentrates value on itself.
      const satisfied = voltron >= 2 || (voltron >= 1 && commanderVoltron);
      return {
        satisfied,
        score: 30,
        evidence: [
          item('anchor.voltron', 'voltron-tagged cards (need 2+, or 1 with commander)', voltron),
          item('anchor.commanderVoltron', 'commander concentrates enhancement', commanderVoltron),
          item('anchor.satisfied', 'voltron intent present', satisfied),
        ],
      };
    },
    engine: (e) => {
      const score = ramp(e.tag('voltron'), 25, 4);
      return { score, evidence: [item('engine.voltronCards', 'voltron card density', e.tag('voltron'), round2(score))] };
    },
    support: (e) => {
      // Only counted after the anchor passes, which is what keeps a protection
      // pile from reading as Voltron.
      const combat =
        e.tag('combat_damage_payoff') + e.tag('extra_combat') + e.tag('attack_payoff');
      const score = ramp(combat, 20, 5);
      return { score, evidence: [item('support.combat', 'combat damage + extra combat + attack payoff', combat, round2(score))] };
    },
    commander: (e) => {
      const relevant =
        e.commanderTag('voltron') +
        e.commanderTag('combat_damage_payoff') +
        e.commanderTag('attack_payoff');
      const score = relevant > 0 ? 15 : 0;
      return { score, evidence: [item('commander.threat', 'commander is the threat or enables it', relevant > 0, score)] };
    },
    density: (e) => {
      const score = ramp(e.tag('aura') + e.type('Artifact'), 10, 14);
      return { score, evidence: [item('density.enhancers', 'auras + artifacts available to attach', e.tag('aura') + e.type('Artifact'), round2(score))] };
    },
  },

  // === Aura Voltron (specialization of Voltron) ===========================
  {
    archetype: 'aura_voltron',
    kind: 'archetype',
    parent: 'voltron',
    anchor: (e, context) => {
      const voltron = context.resolved.get('voltron');
      const voltronFoundation = voltron?.anchorSatisfied === true;
      const auras = e.tag('aura');
      // Requires BOTH a Voltron foundation and meaningful Aura infrastructure.
      const satisfied = voltronFoundation && auras >= 5;
      return {
        satisfied,
        score: 30,
        evidence: [
          item('anchor.voltronFoundation', 'parent Voltron anchor satisfied', voltronFoundation),
          item('anchor.auras', 'aura-tagged cards (need 5+)', auras),
          item('anchor.satisfied', 'aura-based voltron present', satisfied),
        ],
      };
    },
    engine: (e) => {
      const score = ramp(Math.min(e.tag('aura'), e.tag('voltron') + 1), 25, 4);
      return { score, evidence: [item('engine.auraVoltron', 'auras paired with voltron cards', Math.min(e.tag('aura'), e.tag('voltron') + 1), round2(score))] };
    },
    support: (e) => {
      const score = ramp(e.tag('enchantment_payoff') + e.tag('enchantment_cost_reduction'), 15, 4);
      return { score, evidence: [item('support.enchantmentInfrastructure', 'enchantment payoff + reduction', e.tag('enchantment_payoff') + e.tag('enchantment_cost_reduction'), round2(score))] };
    },
    commander: (e) => {
      const relevant = e.commanderTag('aura') + e.commanderTag('voltron');
      const score = relevant > 0 ? 15 : 0;
      return { score, evidence: [item('commander.auraEngine', 'commander tutors or wears auras', relevant > 0, score)] };
    },
    density: (e) => {
      const score = ramp(e.type('Enchantment'), 15, 12);
      return { score, evidence: [item('density.enchantments', 'enchantment count', e.type('Enchantment'), round2(score))] };
    },
  },

  // === Enchantress =======================================================
  {
    archetype: 'enchantress',
    kind: 'archetype',
    anchor: (e) => {
      const payoff = e.tag('enchantment_payoff');
      const satisfied = payoff >= 2;
      return {
        satisfied,
        score: 30,
        evidence: [
          item('anchor.enchantmentPayoff', 'enchantment payoff effects (need 2+)', payoff),
          item('anchor.satisfied', 'enchantment payoff intent present', satisfied),
        ],
      };
    },
    engine: (e) => {
      const score = ramp(
        Math.min(e.tag('enchantment_payoff'), e.type('Enchantment')),
        25,
        5,
      );
      return { score, evidence: [item('engine.payoffWithDensity', 'payoff paired with enchantment count', Math.min(e.tag('enchantment_payoff'), e.type('Enchantment')), round2(score))] };
    },
    support: (e) => {
      const infra =
        e.tag('enchantment_cost_reduction') + e.tag('enchantment_generation') + e.tag('aura');
      const score = ramp(infra, 15, 5);
      return { score, evidence: [item('support.enchantmentInfrastructure', 'reduction + generation + auras', infra, round2(score))] };
    },
    commander: (e) => {
      const relevant = e.commanderTag('enchantment_payoff') + e.commanderTag('enchantment_generation');
      const score = relevant > 0 ? 15 : 0;
      return { score, evidence: [item('commander.engine', 'commander draws on enchantments', relevant > 0, score)] };
    },
    density: (e) => {
      // Only reachable once payoff intent exists.
      const score = ramp(e.type('Enchantment'), 15, 12);
      return { score, evidence: [item('density.enchantments', 'enchantment count', e.type('Enchantment'), round2(score))] };
    },
  },

  // === Counters (theme) ==================================================
  {
    archetype: 'counters',
    kind: 'theme',
    anchor: (e) => {
      const total =
        e.tag('counter_generation') +
        e.tag('counter_payoff') +
        e.tag('counter_doubling') +
        e.tag('plus_one_counters');
      // Loyalty-only cards are excluded: planeswalker loyalty is not a
      // counters strategy.
      const effective = total - e.loyaltyOnlyCounterCards;
      const satisfied = effective >= 6;
      return {
        satisfied,
        score: 30,
        evidence: [
          item('anchor.counterCards', 'counter-relevant cards', total),
          item('anchor.loyaltyOnlyExcluded', 'excluded loyalty-only cards', e.loyaltyOnlyCounterCards),
          item('anchor.effective', 'effective counter cards (need 6+)', effective),
          item('anchor.satisfied', 'counters used as a resource', satisfied),
        ],
      };
    },
    engine: (e) => {
      const score = ramp(
        Math.min(e.tag('counter_generation'), e.tag('counter_payoff') + e.tag('counter_doubling')),
        25,
        3,
      );
      return { score, evidence: [item('engine.generationWithPayoff', 'generation paired with payoff/doubling', Math.min(e.tag('counter_generation'), e.tag('counter_payoff') + e.tag('counter_doubling')), round2(score))] };
    },
    support: (e) => {
      const score = ramp(e.tag('proliferate') + e.tag('plus_one_counters'), 15, 5);
      return { score, evidence: [item('support.proliferateAndPlusOne', 'proliferate + plus-one resource cards', e.tag('proliferate') + e.tag('plus_one_counters'), round2(score))] };
    },
    commander: (e) => {
      const relevant =
        e.commanderTag('counter_generation') +
        e.commanderTag('counter_payoff') +
        e.commanderTag('counter_doubling') +
        e.commanderTag('proliferate');
      const score = relevant > 0 ? 15 : 0;
      return { score, evidence: [item('commander.engine', 'commander creates or exploits counters', relevant > 0, score)] };
    },
    density: (e) => {
      const score = ramp(e.signal('counters') / 10, 15, 4);
      return { score, evidence: [item('density.countersSignal', 'Phase 3B counters signal', round2(e.signal('counters')), round2(score))] };
    },
  },

  // === Proliferate (theme) ===============================================
  {
    archetype: 'proliferate',
    kind: 'theme',
    anchor: (e) => {
      const proliferate = e.tag('proliferate');
      const infra =
        e.tag('counter_generation') + e.tag('counter_payoff') + e.tag('plus_one_counters');
      // Proliferate needs something worth proliferating.
      const satisfied = proliferate >= 3 && infra >= 4;
      return {
        satisfied,
        score: 35,
        evidence: [
          item('anchor.proliferate', 'proliferate effects (need 3+)', proliferate),
          item('anchor.counterInfrastructure', 'counters worth increasing (need 4+)', infra),
          item('anchor.satisfied', 'proliferate engine with targets', satisfied),
        ],
      };
    },
    engine: (e) => {
      const score = ramp(e.tag('proliferate'), 25, 4);
      return { score, evidence: [item('engine.proliferateDensity', 'proliferate density', e.tag('proliferate'), round2(score))] };
    },
    support: (e) => {
      const targets =
        e.tag('counter_generation') + e.tag('counter_payoff') + e.type('Planeswalker');
      const score = ramp(targets, 15, 8);
      return { score, evidence: [item('support.targets', 'counter sources + planeswalkers', targets, round2(score))] };
    },
    commander: (e) => {
      const relevant = e.commanderTag('proliferate');
      const score = relevant > 0 ? 15 : 0;
      return { score, evidence: [item('commander.proliferate', 'commander proliferates', relevant > 0, score)] };
    },
    density: (e) => {
      const score = ramp(e.signal('counters') / 10, 10, 4);
      return { score, evidence: [item('density.countersSignal', 'Phase 3B counters signal', round2(e.signal('counters')), round2(score))] };
    },
  },

  // === Tokens (theme) ====================================================
  {
    archetype: 'tokens',
    kind: 'theme',
    anchor: (e) => {
      const generation = e.tag('token_generation');
      // All token types count for the Tokens theme.
      const satisfied = generation >= 5;
      return {
        satisfied,
        score: 30,
        evidence: [
          item('anchor.tokenGeneration', 'token generators (need 5+)', generation),
          item('anchor.satisfied', 'tokens produced as a resource', satisfied),
        ],
      };
    },
    engine: (e) => {
      const exploit = e.tag('token_payoff') + e.tag('token_doubling');
      const score = ramp(Math.min(e.tag('token_generation'), exploit), 30, 3);
      return { score, evidence: [item('engine.generationWithExploit', 'generation paired with payoff/doubling', Math.min(e.tag('token_generation'), exploit), round2(score))] };
    },
    support: (e) => {
      const score = ramp(e.tag('token_payoff') + e.tag('token_doubling'), 15, 4);
      return { score, evidence: [item('support.exploitDepth', 'payoff + doubling density', e.tag('token_payoff') + e.tag('token_doubling'), round2(score))] };
    },
    commander: (e) => {
      const relevant =
        e.commanderTag('token_generation') +
        e.commanderTag('token_payoff') +
        e.commanderTag('token_doubling');
      const score = relevant > 0 ? 15 : 0;
      return { score, evidence: [item('commander.engine', 'commander makes or exploits tokens', relevant > 0, score)] };
    },
    density: (e) => {
      const score = ramp(e.tag('token_generation'), 10, 10);
      return { score, evidence: [item('density.generationDepth', 'token generator count', e.tag('token_generation'), round2(score))] };
    },
  },

  // === Go-Wide (theme) ===================================================
  {
    archetype: 'go_wide',
    kind: 'theme',
    anchor: (e) => {
      const goWide = e.tag('go_wide_payoff');
      /*
       * Requires a real mass-creature payoff. Creature-token generation is
       * strong evidence AFTER that intent exists, but never establishes it:
       * a token-sacrifice Aristocrats deck that rarely attacks stays Tokens +
       * Aristocrats without becoming Go-Wide.
       */
      const satisfied = goWide >= 2;
      return {
        satisfied,
        score: 30,
        evidence: [
          item('anchor.goWidePayoff', 'mass-creature payoffs (need 2+)', goWide),
          item('anchor.creatureTokenGenerators', 'creature-token generators (support only)', e.creatureTokenGenerators),
          item('anchor.satisfied', 'quantity converted to pressure', satisfied),
        ],
      };
    },
    engine: (e) => {
      // Bodies to go wide with, counted only as creature tokens.
      const score = ramp(Math.min(e.creatureTokenGenerators, e.tag('go_wide_payoff') * 4), 25, 5);
      return { score, evidence: [item('engine.bodies', 'creature-token generators supporting the payoff', e.creatureTokenGenerators, round2(score))] };
    },
    support: (e) => {
      const score = ramp(e.tag('attack_payoff') + e.tag('extra_combat'), 20, 5);
      return { score, evidence: [item('support.combat', 'attack payoff + extra combat', e.tag('attack_payoff') + e.tag('extra_combat'), round2(score))] };
    },
    commander: (e) => {
      const relevant = e.commanderTag('go_wide_payoff') + e.commanderTag('token_generation');
      const score = relevant > 0 ? 15 : 0;
      return { score, evidence: [item('commander.engine', 'commander floods or pays off a wide board', relevant > 0, score)] };
    },
    density: (e) => {
      const score = ramp(e.type('Creature'), 10, 14);
      return { score, evidence: [item('density.creatures', 'creature count', e.type('Creature'), round2(score))] };
    },
  },

  // === Artifacts (theme) =================================================
  {
    archetype: 'artifacts',
    kind: 'theme',
    anchor: (e) => {
      const payoff = e.tag('artifact_payoff');
      const generation = e.tag('artifact_generation');
      const sacrifice = e.tag('artifact_sacrifice');
      const reduction = e.tag('artifact_cost_reduction');
      const density = e.type('Artifact');
      /*
       * Relational by design. Payoff alone is not an artifact deck: it must be
       * paired with generation, sacrifice, cost reduction, or genuinely heavy
       * artifact density. The second path covers artifact-token/resource
       * engines, which need substantial generation AND some payoff or
       * sacrifice to convert it.
       */
      const enginePath =
        payoff >= 2 && (generation >= 2 || sacrifice >= 2 || reduction >= 1 || density >= 15);
      const resourcePath = generation >= 4 && payoff + sacrifice >= 2;
      const satisfied = enginePath || resourcePath;
      return {
        satisfied,
        score: 30,
        evidence: [
          item('anchor.artifactPayoff', 'artifact payoff effects', payoff),
          item('anchor.artifactGeneration', 'artifact generation effects', generation),
          item('anchor.artifactSacrifice', 'artifact sacrifice effects', sacrifice),
          item('anchor.artifactCostReduction', 'artifact cost reduction', reduction),
          item('anchor.artifactDensity', 'artifact cards in mainboard', density),
          item('anchor.enginePath', 'payoff paired with generation/sacrifice/reduction/density', enginePath),
          item('anchor.resourcePath', 'heavy generation converted by payoff/sacrifice', resourcePath),
          item('anchor.satisfied', 'artifact engine present', satisfied),
        ],
      };
    },
    engine: (e) => {
      const converters = e.tag('artifact_payoff') + e.tag('artifact_sacrifice');
      const score = ramp(Math.min(e.tag('artifact_generation') + 1, converters), 25, 3);
      return { score, evidence: [item('engine.generationWithConverters', 'generation paired with payoff/sacrifice', Math.min(e.tag('artifact_generation') + 1, converters), round2(score))] };
    },
    support: (e) => {
      const infra = e.tag('artifact_cost_reduction') + e.tag('artifact_sacrifice');
      const score = ramp(infra, 15, 3);
      return { score, evidence: [item('support.infrastructure', 'cost reduction + sacrifice outlets', infra, round2(score))] };
    },
    commander: (e) => {
      const relevant =
        e.commanderTag('artifact_payoff') +
        e.commanderTag('artifact_generation') +
        e.commanderTag('artifact_sacrifice');
      const score = relevant > 0 ? 15 : 0;
      return { score, evidence: [item('commander.engine', 'commander makes or exploits artifacts', relevant > 0, score)] };
    },
    density: (e) => {
      // Only reachable once artifact-engine intent exists.
      const score = ramp(e.type('Artifact'), 15, 14);
      return { score, evidence: [item('density.artifacts', 'artifact count', e.type('Artifact'), round2(score))] };
    },
  },

  // === Landfall (theme) ==================================================
  {
    archetype: 'landfall',
    kind: 'theme',
    anchor: (e) => {
      const landfall = e.tag('landfall');
      const commanderLandfall = e.commanderTag('landfall') > 0;
      const satisfied = landfall >= 4 || (landfall >= 2 && commanderLandfall);
      return {
        satisfied,
        score: 30,
        evidence: [
          item('anchor.landfall', 'landfall payoffs (need 4+, or 2 with commander)', landfall),
          item('anchor.commanderLandfall', 'commander supplies a landfall engine', commanderLandfall),
          item('anchor.satisfied', 'landfall intent present', satisfied),
        ],
      };
    },
    engine: (e) => {
      const score = ramp(e.tag('landfall'), 25, 4);
      return { score, evidence: [item('engine.landfallDensity', 'landfall payoff density', e.tag('landfall'), round2(score))] };
    },
    support: (e) => {
      // Ramp and extra land drops only matter once landfall intent exists.
      const enablers = e.rampCount + e.tag('land_payoff') + e.tag('land_recursion');
      const score = ramp(enablers, 15, 10);
      return { score, evidence: [item('support.enablers', 'ramp + extra drops + land recursion', enablers, round2(score))] };
    },
    commander: (e) => {
      const relevant = e.commanderTag('landfall') + e.commanderTag('land_payoff');
      const score = relevant > 0 ? 15 : 0;
      return { score, evidence: [item('commander.engine', 'commander turns land drops into value', relevant > 0, score)] };
    },
    density: (e) => {
      const score = ramp(e.landCount - 33, 15, 6);
      return { score, evidence: [item('density.lands', 'lands above a typical 33', e.landCount, round2(score))] };
    },
  },

  // === Lands (theme) =====================================================
  {
    archetype: 'lands',
    kind: 'theme',
    anchor: (e) => {
      const recursion = e.tag('land_recursion');
      const payoff = e.tag('land_payoff');
      // Landfall may support Lands but must never establish it, and ordinary
      // ramp density must not manufacture it either.
      const satisfied = recursion + payoff >= 3;
      return {
        satisfied,
        score: 30,
        evidence: [
          item('anchor.landRecursion', 'land recursion effects', recursion),
          item('anchor.landPayoff', 'land payoff effects', payoff),
          item('anchor.combined', 'recursion + payoff (need 3+)', recursion + payoff),
          item('anchor.satisfied', 'lands reused as a resource', satisfied),
        ],
      };
    },
    engine: (e) => {
      const score = ramp(Math.min(e.tag('land_recursion'), e.tag('land_payoff')) * 2, 25, 3);
      return { score, evidence: [item('engine.recursionWithPayoff', 'recursion paired with payoff', Math.min(e.tag('land_recursion'), e.tag('land_payoff')), round2(score))] };
    },
    support: (e) => {
      const score = ramp(e.tag('landfall'), 15, 4);
      return { score, evidence: [item('support.landfall', 'landfall payoffs supporting land reuse', e.tag('landfall'), round2(score))] };
    },
    commander: (e) => {
      const relevant = e.commanderTag('land_recursion') + e.commanderTag('land_payoff');
      const score = relevant > 0 ? 15 : 0;
      return { score, evidence: [item('commander.engine', 'commander replays or exploits lands', relevant > 0, score)] };
    },
    density: (e) => {
      const score = ramp(e.landCount - 33, 15, 6);
      return { score, evidence: [item('density.lands', 'lands above a typical 33', e.landCount, round2(score))] };
    },
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Infer archetypes and themes for a deck.
 *
 * Definitions are evaluated in declared order so a specialization can read its
 * parent's result (Aura Voltron requires Voltron's anchor).
 */
export function inferDeckArchetypes(
  composition: DeckComposition,
  strategy: DeckStrategyProfile,
): DeckArchetypeProfile {
  const evidence = gatherEvidence(composition, strategy);
  const resolved = new Map<ArchetypeInferenceType, ArchetypeInference>();
  const context: InferenceContext = { resolved };

  for (const definition of DEFINITIONS) {
    const anchor = definition.anchor(evidence, context);

    if (!anchor.satisfied) {
      // Anchor gating: no supporting evidence can revive a missing anchor.
      resolved.set(definition.archetype, {
        archetype: definition.archetype,
        kind: definition.kind,
        score: 0,
        confidence: confidenceFor(0),
        ...(definition.parent ? { parent: definition.parent } : {}),
        anchorSatisfied: false,
        evidence: anchor.evidence,
      });
      continue;
    }

    const engine = definition.engine(evidence);
    const support = definition.support(evidence);
    const commander = definition.commander(evidence);
    // Contextual density counts only now that intent is established.
    const density = definition.density(evidence);

    let score = clamp(
      anchor.score + engine.score + support.score + commander.score + density.score,
      0,
      100,
    );

    const extraEvidence: ArchetypeEvidenceItem[] = [];

    // A specialization must never outrank its parent.
    if (definition.parent) {
      const parent = resolved.get(definition.parent);
      const parentScore = parent?.score ?? 0;
      if (score > parentScore) {
        extraEvidence.push(
          item('cap.parent', `capped to parent ${definition.parent} score`, parentScore, round2(parentScore - score)),
        );
        score = parentScore;
      }
    }

    resolved.set(definition.archetype, {
      archetype: definition.archetype,
      kind: definition.kind,
      score: round2(score),
      confidence: confidenceFor(score),
      ...(definition.parent ? { parent: definition.parent } : {}),
      anchorSatisfied: true,
      evidence: [
        ...anchor.evidence,
        item('component.anchor', 'anchor contribution', undefined, anchor.score),
        ...engine.evidence,
        ...support.evidence,
        ...commander.evidence,
        ...density.evidence,
        ...extraEvidence,
      ],
    });
  }

  return {
    inferences: ARCHETYPE_INFERENCE_TYPES.map((t) => resolved.get(t)).filter(
      (i): i is ArchetypeInference => i !== undefined,
    ),
  };
}
