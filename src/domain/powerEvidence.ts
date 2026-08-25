import { buildCardText } from './cardText';
import { isLand } from './cardFacts';
import { classifyCardRoles } from './roles';
import { classifyCardTags } from './tags';
import {
  analyzeCardPower,
  interactionTargets,
  isCounterspell,
  POWER_PROPERTIES,
  type InteractionTarget,
  type PowerProperty,
} from './powerCards';
import { comboOverlap, detectCombos, type DetectedCombo } from './knownCombos';
import { extractManaBaseFacts, type ManaBaseFacts } from './manaBase';
import { extractTutorRelevance, type TutorRelevanceEvidence } from './tutorRelevance';
import type {
  CardRole,
  CardTag,
  DeckArchetypeProfile,
  DeckComposition,
  DeckStrategyProfile,
  ResolvedCard,
} from './types';

/**
 * Deterministic power-relevant EVIDENCE extraction. Pure.
 *
 * Phase 4A deliberately produces no score, rating, or turn prediction — only
 * explainable facts that a later phase can weigh. Everything here is grouped
 * so no number stands alone without its provenance.
 */

// ---------------------------------------------------------------------------
// Stax / resource denial
// ---------------------------------------------------------------------------

export type StaxRestriction =
  | 'spellLimit'
  | 'spellTax'
  | 'manaDenial'
  | 'landDenial'
  | 'artifactDenial'
  | 'graveyardDenial'
  | 'searchDenial'
  | 'castingDenial'
  | 'resourceDenial';

const STAX_PATTERNS: Readonly<Record<StaxRestriction, RegExp>> = {
  spellLimit: /\bcan't cast more than one\b|\bcast only one\b|\bplay(?:ers)? can't cast spells\b/i,
  spellTax: /\bcosts?\s*\{\d+\}\s*more to cast\b|\bunless (?:that|its) (?:player|controller) pays\b/i,
  manaDenial: /\bdon't untap\b|\bdoesn't untap\b|\btap all\b|\bmana abilities of\b[^.]{0,30}\bcan't\b/i,
  landDenial: /\blands? (?:are|is)\b[^.]{0,40}\bin addition to\b|\bplay(?:ers)? can't play lands\b|\bare Mountains\b/i,
  artifactDenial: /\bactivated abilities of artifacts\b[^.]{0,20}\bcan't\b|\bartifacts?\b[^.]{0,30}\bcan't be activated\b/i,
  graveyardDenial: /\bcan't (?:be cast|enter the battlefield) from (?:graveyards?|libraries)\b|\bexile it instead\b/i,
  searchDenial: /\bcan't search\b|\bsearch(?:es)? their library\b[^.]{0,60}\byou (?:control|may)\b/i,
  castingDenial: /\bcan't cast\b|\bcan't be cast\b/i,
  resourceDenial: /\bskip (?:their|your) (?:draw step|untap step)\b|\bcan't draw\b|\bcan't attack\b(?![^.]{0,20}\byou\b)/i,
};

/**
 * Cards whose stax function is real but not phrased in a way general patterns
 * catch. Kept intentionally tiny, per the precision-first discipline.
 */
const CURATED_STAX = new Set(
  [
    'Winter Orb',
    'Static Orb',
    'Trinisphere',
    'Sphere of Resistance',
    'Blood Moon',
    'Magus of the Moon',
    'Null Rod',
    'Stony Silence',
    'Collector Ouphe',
    'Damping Sphere',
    'Rule of Law',
    'Archon of Emeria',
    'Drannith Magistrate',
    'Opposition Agent',
    'Aven Mindcensor',
    'Thalia, Guardian of Thraben',
    'Rest in Peace',
    "Grafdigger's Cage",
    'Dauthi Voidwalker',
  ].map((n) => n.toLowerCase()),
);

/**
 * Explicitly NOT stax, per the specification: pillow-fort effects tax attacks
 * rather than deny resources, Grand Abolisher protects a window, and graveyard
 * hate is already its own category.
 */
const NOT_STAX = new Set(
  [
    'Grand Abolisher',
    'Propaganda',
    'Ghostly Prison',
    'Sphere of Safety',
    // Only single-shot graveyard removal is excluded. Persistent graveyard
    // LOCKS (Rest in Peace, Grafdigger's Cage, Dauthi Voidwalker) are listed
    // as stax positives by the specification and stay in.
    'Bojuka Bog',
    "Tormod's Crypt",
  ].map((n) => n.toLowerCase()),
);

export interface StaxEvidence {
  staxCount: number;
  restrictionCoverage: Record<StaxRestriction, number>;
  cards: string[];
}

/**
 * A restriction aimed at ONE specific object rather than at players or the
 * game system. Pacifying auras ("enchanted creature can't attack"), targeted
 * effects, and self-referential drawbacks are not stax.
 *
 * Corpus review of the first pass showed this is the dominant false-positive
 * family: Waterknot, Tangle Kelp, Compulsory Rest and similar Auras all
 * matched a bare "can't attack" / "can't cast" probe.
 */
const OBJECT_SCOPED_SUBJECT =
  /\b(?:enchanted|equipped)\s+(?:creature|permanent|player|land)\b|\btarget\s+(?:creature|permanent|player|land|artifact)\b|\bthat\s+(?:creature|permanent)\b|\bthis\s+(?:creature|permanent|artifact|enchantment|land)\b/i;

/**
 * Does the clause constrain opponents or the whole game, rather than a single
 * object? Stax is a persistent system-wide tax, not a Pacifism.
 */
function isSystemWideRestriction(clause: string): boolean {
  if (OBJECT_SCOPED_SUBJECT.test(clause)) return false;
  return /\bplayers?\b|\bopponents?\b|\beach\b|\ball\b|\bcreatures\b|\bspells\b|\blands\b|\bartifacts\b|\bpermanents\b/i.test(
    clause,
  );
}

function staxRestrictions(card: ResolvedCard): StaxRestriction[] {
  const name = card.name.trim().toLowerCase();
  if (NOT_STAX.has(name)) return [];

  const text = buildCardText(card);
  const matched = new Set<StaxRestriction>();
  for (const clause of text.frontClauses) {
    // Scope the subject BEFORE accepting any restriction pattern.
    if (!isSystemWideRestriction(clause)) continue;
    for (const r of Object.keys(STAX_PATTERNS) as StaxRestriction[]) {
      if (STAX_PATTERNS[r].test(clause)) matched.add(r);
    }
  }
  if (matched.size > 0) return [...matched];
  // Curated cards count once under the closest generic category.
  if (CURATED_STAX.has(name)) return ['resourceDenial'];
  return [];
}

// ---------------------------------------------------------------------------
// Grouped evidence
// ---------------------------------------------------------------------------

export interface CurveEvidence {
  averageManaValue: number;
  medianManaValue: number;
  mv0: number;
  mv1: number;
  mv2: number;
  mv3: number;
  mv4: number;
  mv5: number;
  mv6Plus: number;
  /** Nonland cards with MV <= 2. */
  earlyPlayCount: number;
  /** Nonland cards with MV >= 6. */
  expensiveCardCount: number;
  rampCount: number;
  fastManaCount: number;
  /** Mana values of the ramp pieces, ascending. */
  rampManaValues: number[];
}

export interface TutorEvidence {
  tutorCount: number;
  efficientTutorCount: number;
  cardSelectionCount: number;
}

export interface InteractionEvidence {
  interactionCount: number;
  targetedInteractionCount: number;
  boardWipeCount: number;
  graveyardHateCount: number;
  efficientInteractionCount: number;
  freeInteractionCount: number;
  stackInteractionCount: number;
  permanentInteractionCount: number;
  graveyardInteractionCount: number;
  counterspellCount: number;
  efficientCounterspellCount: number;
  freeCounterspellCount: number;
  targetCoverage: Record<InteractionTarget, number>;
}

export interface ProtectionEvidence {
  protectionCount: number;
  efficientProtectionCount: number;
}

export interface CardAdvantageEvidence {
  cardAdvantageCount: number;
  efficientCardAdvantageCount: number;
  repeatableCardAdvantageCount: number;
  efficientAndRepeatableCount: number;
}

export interface ResilienceEvidence {
  protectionCount: number;
  efficientProtectionCount: number;
  recursionCount: number;
  reanimationCount: number;
  landRecursionCount: number;
  spellRecursionCount: number;
  /** Cards supporting the primary strategy, from Phase 3C evidence. */
  primaryStrategyRedundancy: number;
  commanderProvidesPrimaryEngine: boolean;
}

export interface ConsistencyEvidence {
  tutorCount: number;
  efficientTutorCount: number;
  /**
   * What the deck's tutors can actually find. Raw tutor count alone is a poor
   * consistency signal; this records confirmed relevance separately.
   */
  tutorRelevance: TutorRelevanceEvidence;
  cardSelectionCount: number;
  cardAdvantageCount: number;
  efficientCardAdvantageCount: number;
  repeatableCardAdvantageCount: number;
  commanderProvidesPrimaryEngine: boolean;
  /** Tags/roles supporting the deck's primary strategy. */
  primaryStrategyFunctionalSupport: number;
  comboPiecesNeededFromLibrary: number;
}

/**
 * A recognised win condition together with WHY it is (or is not) relevant to
 * the deck's primary strategy.
 *
 * Alignment is derived from evidence the earlier phases already produce: a
 * card's Phase 3A tags must overlap the tags that functionally support the
 * Phase 3C primary archetype. Presence in the deck is never sufficient, and
 * sharing a card type with the strategy is not considered at all — which is
 * why Walking Ballista does not become an Artifacts finisher.
 */
export interface AlignedWinCondition {
  name: string;
  aligned: boolean;
  /** Primary archetype the alignment was tested against. */
  archetype: string;
  /** Phase 3A tags the card and the archetype's support set share. */
  sharedTags: CardTag[];
  /** The card's own Phase 3A tags, for diagnostics. */
  cardTags: CardTag[];
}

export interface WinPackageEvidence {
  winConditionCount: number;
  comboPieceCount: number;
  /** Every recognised win condition with its alignment verdict. */
  alignedWinConditions: AlignedWinCondition[];
  /** Complete curated combos only. */
  detectedCompactComboCount: number;
  deterministicWinComboCount: number;
  resourceComboCount: number;
  uniqueComboPieces: number;
  sharedComboPieces: number;
  /** Known combos with some but not all pieces present. */
  partialComboCount: number;
  /** Every match, complete or partial, for diagnostics. */
  combos: DetectedCombo[];
}

export interface CommanderEngineEvidence {
  commanderProvidesPrimaryEngine: boolean;
  commanderPrimaryTags: CardTag[];
  mainboardRedundantEngineCount: number;
}

export interface DeckPowerEvidence {
  /** Per-card property assignments, provenance preserved. */
  cardProperties: { name: string; property: PowerProperty; ruleId: string }[];
  propertyCounts: Record<PowerProperty, number>;
  mana: CurveEvidence;
  manaBase: ManaBaseFacts;
  tutors: TutorEvidence;
  interaction: InteractionEvidence;
  protection: ProtectionEvidence;
  cardAdvantage: CardAdvantageEvidence;
  resilience: ResilienceEvidence;
  consistency: ConsistencyEvidence;
  commanderEngine: CommanderEngineEvidence;
  stax: StaxEvidence;
  winPackage: WinPackageEvidence;
}

/** Tags that functionally support each archetype, reusing Phase 3 vocabulary. */
export const PRIMARY_SUPPORT_TAGS: Partial<Record<string, CardTag[]>> = {
  reanimator: ['reanimation', 'graveyard_filling', 'self_mill'],
  aristocrats: ['sacrifice_outlet', 'sacrifice_fodder', 'sacrifice_payoff', 'death_payoff'],
  tokens: ['token_generation', 'token_payoff', 'token_doubling'],
  spellslinger: ['spell_payoff', 'spell_cost_reduction', 'spell_copy', 'spell_recursion'],
  superfriends: ['planeswalker_payoff', 'planeswalker_generation', 'planeswalker_doubling'],
  counters: ['counter_generation', 'counter_payoff', 'counter_doubling', 'plus_one_counters'],
  proliferate: ['proliferate', 'counter_generation', 'counter_payoff'],
  artifacts: ['artifact_generation', 'artifact_payoff', 'artifact_sacrifice', 'artifact_cost_reduction'],
  enchantress: ['enchantment_payoff', 'enchantment_generation', 'enchantment_cost_reduction', 'aura'],
  voltron: ['voltron', 'aura'],
  aura_voltron: ['aura', 'voltron', 'enchantment_payoff'],
  landfall: ['landfall', 'land_payoff'],
  lands: ['land_recursion', 'land_payoff', 'landfall'],
  go_wide: ['go_wide_payoff', 'token_generation', 'attack_payoff'],
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0);
}

/**
 * Extract every power-relevant fact for a deck.
 *
 * Phase 3B signals and Phase 3C inferences are passed in rather than
 * recomputed, so archetype logic is never duplicated here.
 */
export function extractDeckPowerEvidence(
  composition: DeckComposition,
  strategy: DeckStrategyProfile,
  archetypes: DeckArchetypeProfile,
): DeckPowerEvidence {
  interface Slot {
    card: ResolvedCard;
    quantity: number;
    isCommander: boolean;
    roles: Set<CardRole>;
    tags: Set<CardTag>;
    powers: Set<PowerProperty>;
  }

  const build = (card: ResolvedCard, quantity: number, isCommander: boolean): Slot => ({
    card,
    quantity,
    isCommander,
    roles: new Set(classifyCardRoles(card).assignments.map((a) => a.role)),
    tags: new Set(classifyCardTags(card).assignments.map((a) => a.tag)),
    powers: new Set(analyzeCardPower(card).assignments.map((a) => a.property)),
  });

  const slots: Slot[] = [
    ...composition.commanders.map((c) => build(c, 1, true)),
    ...composition.mainboard.map(({ card, quantity }) => build(card, quantity, false)),
  ];
  const mainboard = slots.filter((s) => !s.isCommander);

  const sum = (list: Slot[], predicate: (s: Slot) => boolean) =>
    list.filter(predicate).reduce((total, s) => total + s.quantity, 0);

  // --- per-card provenance ------------------------------------------------
  const cardProperties: { name: string; property: PowerProperty; ruleId: string }[] = [];
  const propertyCounts = Object.fromEntries(
    POWER_PROPERTIES.map((p) => [p, 0]),
  ) as Record<PowerProperty, number>;
  for (const slot of slots) {
    for (const a of analyzeCardPower(slot.card).assignments) {
      cardProperties.push({ name: slot.card.name, property: a.property, ruleId: a.ruleId });
      propertyCounts[a.property] += slot.quantity;
    }
  }

  // --- curve (nonland only) ----------------------------------------------
  const nonland = mainboard.filter((s) => !isLand(s.card));
  const mvList: number[] = [];
  for (const s of nonland) for (let i = 0; i < s.quantity; i += 1) mvList.push(Math.floor(s.card.cmc));
  const bucket = (test: (mv: number) => boolean) => mvList.filter(test).length;
  const rampSlots = mainboard.filter((s) => s.roles.has('ramp'));
  const rampManaValues: number[] = [];
  for (const s of rampSlots) for (let i = 0; i < s.quantity; i += 1) rampManaValues.push(s.card.cmc);

  const mana: CurveEvidence = {
    averageManaValue:
      mvList.length === 0
        ? 0
        : Math.round((mvList.reduce((a, b) => a + b, 0) / mvList.length) * 100) / 100,
    medianManaValue: median(mvList),
    mv0: bucket((mv) => mv === 0),
    mv1: bucket((mv) => mv === 1),
    mv2: bucket((mv) => mv === 2),
    mv3: bucket((mv) => mv === 3),
    mv4: bucket((mv) => mv === 4),
    mv5: bucket((mv) => mv === 5),
    mv6Plus: bucket((mv) => mv >= 6),
    earlyPlayCount: bucket((mv) => mv <= 2),
    expensiveCardCount: bucket((mv) => mv >= 6),
    rampCount: sum(mainboard, (s) => s.roles.has('ramp')),
    fastManaCount: sum(slots, (s) => s.powers.has('fast_mana')),
    rampManaValues: rampManaValues.sort((a, b) => a - b),
  };

  // --- interaction --------------------------------------------------------
  const targetCoverage = {
    creature: 0, artifact: 0, enchantment: 0, planeswalker: 0, land: 0, spell: 0, graveyard: 0,
  } as Record<InteractionTarget, number>;
  for (const s of slots) {
    if (!s.roles.has('interaction')) continue;
    for (const t of interactionTargets(s.card)) targetCoverage[t] += s.quantity;
  }

  const interaction: InteractionEvidence = {
    interactionCount: sum(slots, (s) => s.roles.has('interaction')),
    targetedInteractionCount: sum(slots, (s) => s.roles.has('interaction') && !s.roles.has('board_wipe')),
    boardWipeCount: sum(slots, (s) => s.roles.has('board_wipe')),
    graveyardHateCount: sum(slots, (s) => s.roles.has('graveyard_hate')),
    efficientInteractionCount: sum(slots, (s) => s.powers.has('efficient_interaction')),
    freeInteractionCount: sum(slots, (s) => s.powers.has('free_interaction')),
    stackInteractionCount: sum(slots, (s) => s.roles.has('interaction') && isCounterspell(s.card)),
    permanentInteractionCount: sum(
      slots,
      (s) => s.roles.has('interaction') && !isCounterspell(s.card),
    ),
    graveyardInteractionCount: sum(slots, (s) => s.roles.has('graveyard_hate')),
    counterspellCount: sum(slots, (s) => isCounterspell(s.card)),
    efficientCounterspellCount: sum(
      slots,
      (s) => isCounterspell(s.card) && s.powers.has('efficient_interaction'),
    ),
    freeCounterspellCount: sum(
      slots,
      (s) => isCounterspell(s.card) && s.powers.has('free_interaction'),
    ),
    targetCoverage,
  };

  // --- primary strategy, reusing Phase 3C ---------------------------------
  const satisfied = archetypes.inferences
    .filter((i) => i.anchorSatisfied)
    .sort((a, b) => b.score - a.score);
  const primary = satisfied[0];
  const primaryTags = primary ? (PRIMARY_SUPPORT_TAGS[primary.archetype] ?? []) : [];
  const primaryStrategySupport = sum(
    mainboard,
    (s) => primaryTags.some((t) => s.tags.has(t)),
  );
  const commanderPrimaryTags = primary
    ? primaryTags.filter((t) => slots.some((s) => s.isCommander && s.tags.has(t)))
    : [];
  const commanderProvidesPrimaryEngine = commanderPrimaryTags.length > 0;

  /*
   * --- win-condition alignment -------------------------------------------
   * A recognised finisher counts as aligned only when its own strategy tags
   * overlap the tags supporting the primary archetype. This reuses Phase 3A
   * tags and the Phase 3C primary inference rather than inventing any
   * card-to-archetype mapping.
   */
  const alignedWinConditions: AlignedWinCondition[] = [];
  for (const slot of slots) {
    if (!slot.powers.has('win_condition')) continue;
    if (alignedWinConditions.some((w) => w.name === slot.card.name)) continue;
    const cardTags = [...slot.tags];
    const sharedTags = primaryTags.filter((t) => slot.tags.has(t));
    alignedWinConditions.push({
      name: slot.card.name,
      aligned: sharedTags.length > 0,
      archetype: primary?.archetype ?? '(none)',
      sharedTags,
      cardTags,
    });
  }

  // --- combos -------------------------------------------------------------
  const combos = detectCombos(composition);
  const completeCombos = combos.filter((c) => c.complete);
  const overlap = comboOverlap(combos);

  /*
   * --- tutor relevance ----------------------------------------------------
   * Needs the combo pieces present in the deck and the primary support tags,
   * so it is computed after both.
   */
  const comboPieceNames = new Set(
    combos.flatMap((c) => c.pieces.filter((p) => p.location !== 'library').map((p) => p.name)),
  );
  const tutorRelevance = extractTutorRelevance({
    cards: slots.map((s) => s.card),
    comboPieceNames,
    primarySupportTags: primaryTags,
  });

  // --- stax ---------------------------------------------------------------
  const restrictionCoverage = {
    spellLimit: 0, spellTax: 0, manaDenial: 0, landDenial: 0, artifactDenial: 0,
    graveyardDenial: 0, searchDenial: 0, castingDenial: 0, resourceDenial: 0,
  } as Record<StaxRestriction, number>;
  const staxCards: string[] = [];
  let staxCount = 0;
  for (const s of slots) {
    const restrictions = staxRestrictions(s.card);
    if (restrictions.length === 0) continue;
    staxCount += s.quantity;
    staxCards.push(s.card.name);
    for (const r of restrictions) restrictionCoverage[r] += s.quantity;
  }

  const protectionCount = sum(slots, (s) => s.roles.has('protection'));
  const efficientProtectionCount = sum(slots, (s) => s.powers.has('efficient_protection'));
  const cardAdvantageCount = sum(slots, (s) => s.roles.has('card_advantage'));

  return {
    cardProperties,
    propertyCounts,
    mana,
    manaBase: extractManaBaseFacts(composition),
    tutors: {
      tutorCount: sum(slots, (s) => s.roles.has('tutor')),
      efficientTutorCount: sum(slots, (s) => s.powers.has('efficient_tutor')),
      cardSelectionCount: sum(slots, (s) => s.roles.has('card_selection')),
    },
    interaction,
    protection: { protectionCount, efficientProtectionCount },
    cardAdvantage: {
      cardAdvantageCount,
      efficientCardAdvantageCount: sum(slots, (s) => s.powers.has('efficient_card_advantage')),
      repeatableCardAdvantageCount: sum(slots, (s) => s.powers.has('repeatable_card_advantage')),
      efficientAndRepeatableCount: sum(
        slots,
        (s) => s.powers.has('efficient_card_advantage') && s.powers.has('repeatable_card_advantage'),
      ),
    },
    resilience: {
      protectionCount,
      efficientProtectionCount,
      recursionCount: sum(slots, (s) => s.roles.has('recursion')),
      reanimationCount: sum(slots, (s) => s.tags.has('reanimation')),
      landRecursionCount: sum(slots, (s) => s.tags.has('land_recursion')),
      spellRecursionCount: sum(slots, (s) => s.tags.has('spell_recursion')),
      primaryStrategyRedundancy: primaryStrategySupport,
      commanderProvidesPrimaryEngine,
    },
    consistency: {
      tutorCount: sum(slots, (s) => s.roles.has('tutor')),
      efficientTutorCount: sum(slots, (s) => s.powers.has('efficient_tutor')),
      tutorRelevance,
      cardSelectionCount: sum(slots, (s) => s.roles.has('card_selection')),
      cardAdvantageCount,
      efficientCardAdvantageCount: sum(slots, (s) => s.powers.has('efficient_card_advantage')),
      repeatableCardAdvantageCount: sum(slots, (s) => s.powers.has('repeatable_card_advantage')),
      commanderProvidesPrimaryEngine,
      primaryStrategyFunctionalSupport: primaryStrategySupport,
      comboPiecesNeededFromLibrary: combos.reduce((n, c) => n + c.piecesNeededFromLibrary, 0),
    },
    commanderEngine: {
      commanderProvidesPrimaryEngine,
      commanderPrimaryTags,
      mainboardRedundantEngineCount: primaryStrategySupport,
    },
    stax: { staxCount, restrictionCoverage, cards: staxCards },
    winPackage: {
      winConditionCount: sum(slots, (s) => s.powers.has('win_condition')),
      comboPieceCount: sum(slots, (s) => s.powers.has('combo_piece')),
      alignedWinConditions,
      // A combo counts only when every piece is actually present.
      detectedCompactComboCount: completeCombos.length,
      deterministicWinComboCount: completeCombos.filter(
        (c) => c.result === 'immediate_win' || c.result === 'deterministic_win',
      ).length,
      resourceComboCount: completeCombos.filter(
        (c) => c.result.startsWith('infinite') || c.result === 'infinite_resource',
      ).length,
      partialComboCount: combos.length - completeCombos.length,
      uniqueComboPieces: overlap.uniqueComboPieces,
      sharedComboPieces: overlap.sharedComboPieces,
      combos,
    },
  };
}
