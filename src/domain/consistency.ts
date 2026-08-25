import { analyzeDeckTags } from './tags';
import type { DetectedCombo } from './knownCombos';
import type { DeckPowerEvidence } from './powerEvidence';
import type { TutorTarget } from './tutorRelevance';
import type {
  ArchetypeInferenceType,
  CardTag,
  DeckArchetypeProfile,
  DeckComposition,
} from './types';

/**
 * Phase 4B.2 — the CONSISTENCY power dimension. Pure.
 *
 * Answers "how reliably can this deck access and reproduce the cards,
 * resources, and engine pieces needed to execute its primary game plan?"
 *
 * Consistency CONSUMES Phase 4A evidence and never classifies cards. The one
 * structure defined here is a declarative functional model over EXISTING
 * Phase 3A tags: it says which functions an archetype actually requires, which
 * is a scoring question rather than a classification one.
 *
 * Deliberately excluded: mana curve, fast mana, and tapped-land burden belong
 * to Speed and a future Mana Quality dimension. Archetype STRENGTH is never a
 * direct bonus — Phase 3C tells us what the deck is, and Consistency asks only
 * whether it can execute that plan.
 */

export type ConsistencyRating = 'low' | 'moderate' | 'good' | 'high' | 'elite';

/**
 * Which access path produced the targeted-access score. Diagnostics only: the
 * score is always max(general, combo), and 'both' records a genuine tie rather
 * than silently attributing it to whichever branch was compared first.
 */
export type TargetedAccessSource = 'general' | 'combo' | 'both' | 'none';

export interface ConsistencyComponent {
  score: number;
  max: number;
  raw: Record<string, number | boolean | string>;
}

/** Support behind one required function or alternative group. */
export interface FunctionSupport {
  /** Group label: a single tag, or "a | b" for an alternative group. */
  id: string;
  tags: CardTag[];
  /** Deduplicated support across the group's alternatives. */
  support: number;
  saturation: number;
  covered: boolean;
  kind: 'required' | 'optional';
  /** Per-tag support, kept visible even inside an alternative group. */
  perTag: Record<string, number>;
}

export interface RedundancyComponent extends ConsistencyComponent {
  functions: FunctionSupport[];
  requiredCoverage: number;
  completenessMultiplier: number;
  /** Points contributed by active optional functions, at most OPTIONAL_MAX. */
  optionalBonus: number;
  /** Mean saturation across ACTIVE optionals only. */
  optionalSaturation: number;
  /** Active optionals as a fraction of those the archetype defines. */
  optionalCoverage: number;
}

export interface ConsistencyDimension {
  score: number;
  rating: ConsistencyRating;
  targetedAccess: ConsistencyComponent;
  selection: ConsistencyComponent;
  cardFlow: ConsistencyComponent;
  redundancy: RedundancyComponent;
  commanderAccess: ConsistencyComponent;
  limitations: string[];
}

// ---------------------------------------------------------------------------
// Functional model
// ---------------------------------------------------------------------------

/**
 * What each archetype actually REQUIRES to function, as opposed to what merely
 * supports it.
 *
 * Deliberately local to Consistency and distinct from PRIMARY_SUPPORT_TAGS,
 * which is a support vocabulary rather than a requirement list. Reusing it
 * blindly would penalise correctly-built decks: measured across the
 * Commander-legal corpus, planeswalker_generation and planeswalker_doubling
 * exist on ONE card each, so requiring them would cap every Superfriends deck
 * at 1/3 coverage forever. Equipment Voltron legitimately runs zero Auras.
 *
 * A CardTag is a single required function. A CardTag[] is an OR group,
 * satisfied by any member, scored as ONE requirement with support
 * deduplicated by physical card.
 */
interface ConsistencyFunctionDefinition {
  required: Array<CardTag | CardTag[]>;
  optional: CardTag[];
}

const FUNCTIONAL_MODEL: Partial<
  Record<ArchetypeInferenceType, ConsistencyFunctionDefinition>
> = {
  reanimator: {
    required: ['reanimation', ['graveyard_filling', 'self_mill']],
    optional: [],
  },
  aristocrats: {
    required: ['sacrifice_outlet', ['sacrifice_payoff', 'death_payoff']],
    optional: ['sacrifice_fodder'],
  },
  tokens: {
    required: ['token_generation', 'token_payoff'],
    optional: ['token_doubling'],
  },
  spellslinger: {
    required: ['spell_payoff'],
    optional: ['spell_cost_reduction', 'spell_copy', 'spell_recursion'],
  },
  artifacts: {
    required: ['artifact_generation', 'artifact_payoff'],
    optional: ['artifact_sacrifice', 'artifact_cost_reduction'],
  },
  superfriends: {
    required: ['planeswalker_payoff'],
    optional: ['planeswalker_generation', 'planeswalker_doubling'],
  },
  voltron: {
    required: ['voltron'],
    optional: ['aura'],
  },
  counters: {
    required: ['counter_generation', 'counter_payoff'],
    optional: ['counter_doubling', 'plus_one_counters'],
  },
  proliferate: {
    required: ['proliferate', ['counter_generation', 'counter_payoff']],
    optional: [],
  },
  lands: {
    required: [['land_recursion', 'land_payoff']],
    optional: ['landfall'],
  },
  landfall: {
    required: ['landfall'],
    optional: ['land_payoff'],
  },
  go_wide: {
    required: ['go_wide_payoff', 'token_generation'],
    optional: ['attack_payoff'],
  },
  enchantress: {
    required: ['enchantment_payoff'],
    optional: ['enchantment_generation', 'enchantment_cost_reduction', 'aura'],
  },
  aura_voltron: {
    required: ['aura', 'voltron'],
    optional: ['enchantment_payoff'],
  },
};

// ---------------------------------------------------------------------------
// Scoring primitives
// ---------------------------------------------------------------------------

const TARGETED_ACCESS_MAX = 30;
const SELECTION_MAX = 20;
const CARD_FLOW_MAX = 15;
const REDUNDANCY_MAX = 25;
const COMMANDER_ACCESS_MAX = 10;

/**
 * Maximum points active optional functions can add to the redundancy score.
 *
 * Deliberately ADDITIVE rather than a multiplier on the required base. A
 * multiplier scales the reward by how strong the deck already is, so the same
 * optional card is worth ~4x more to a saturated deck than to a thin one; an
 * optional should be valued for what it contributes, not for its owner's
 * existing strength. Additive also keeps optionals from saturating the
 * component on their own.
 */
const OPTIONAL_MAX = 3;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round2 = (n: number) => Math.round(n * 100) / 100;
const saturating = (value: number, max: number, scale: number) =>
  value <= 0 ? 0 : max * (1 - Math.exp(-value / scale));
/** Per-function saturation: 3 supporting cards is most of the benefit. */
const functionSaturation = (support: number) =>
  support <= 0 ? 0 : 1 - Math.exp(-support / 3);

export function ratingFor(score: number): ConsistencyRating {
  if (score < 25) return 'low';
  if (score < 45) return 'moderate';
  if (score < 65) return 'good';
  if (score < 80) return 'high';
  return 'elite';
}

// ---------------------------------------------------------------------------
// Targeted access
// ---------------------------------------------------------------------------

const hasExact = (matches: { confidence: string }[]) =>
  matches.some((m) => m.confidence === 'exact');

/**
 * Tutor access to the primary plan.
 *
 * Every physical tutor occupies only its STRONGEST applicable bucket, so a
 * tutor that is both win- and engine-relevant is credited once. Generic tutors
 * that hit neither contribute nothing: a Mystical Tutor in a Superfriends deck
 * finds none of its planeswalkers.
 */
function scoreGeneralAccess(tutors: readonly TutorTarget[]): {
  score: number;
  raw: Record<string, number>;
} {
  let efficientRelevant = 0;
  let ordinaryRelevant = 0;
  let engineOnly = 0;

  for (const tutor of tutors) {
    const findsWin = hasExact(tutor.findsWinConditions) || hasExact(tutor.findsComboPieces);
    const findsEngine = hasExact(tutor.findsPrimaryEngine);
    if (findsWin) {
      if (tutor.efficient) efficientRelevant += 1;
      else ordinaryRelevant += 1;
    } else if (findsEngine) {
      engineOnly += 1;
    }
  }

  const weighted = 3 * efficientRelevant + 1.5 * ordinaryRelevant + 1 * engineOnly;
  return {
    score: saturating(weighted, TARGETED_ACCESS_MAX, 4),
    raw: { efficientRelevant, ordinaryRelevant, engineOnly, weightedPool: round2(weighted) },
  };
}

/**
 * Access to a COMPLETE combo.
 *
 * Owning a combo is not consistency; access to it is. A naturally drawn
 * two-card combo with no tutors and no command-zone piece scores zero, which
 * is why this is folded with max() rather than added.
 *
 * `piecesNeededFromLibrary` is deliberately absent: a complete combo has every
 * piece in the deck by definition, so the term would always be zero.
 */
function scoreComboAccess(
  combos: readonly DetectedCombo[],
  tutors: readonly TutorTarget[],
  sharedComboPieces: number,
): { score: number; raw: Record<string, number | string> } {
  const complete = combos.filter((c) => c.complete);
  if (complete.length === 0) {
    return { score: 0, raw: { completeCombos: 0, comboPool: 0 } };
  }

  let best = { score: 0, raw: { completeCombos: complete.length, comboPool: 0 } as Record<string, number | string> };

  for (const combo of complete) {
    const pieceNames = new Set(combo.pieces.map((p) => p.name));
    const relevant = tutors.filter((t) =>
      t.findsComboPieces.some((m) => m.confidence === 'exact' && pieceNames.has(m.cardName)),
    );
    const efficientComboTutors = relevant.filter((t) => t.efficient).length;
    const otherComboTutors = relevant.length - efficientComboTutors;

    const pool = clamp(
      3 * efficientComboTutors +
        1.5 * otherComboTutors +
        4 * combo.piecesInCommandZone +
        1 * sharedComboPieces,
      0,
      Number.POSITIVE_INFINITY,
    );
    const score = saturating(pool, TARGETED_ACCESS_MAX, 4);
    if (score > best.score) {
      best = {
        score,
        raw: {
          completeCombos: complete.length,
          comboId: combo.id,
          efficientComboTutors,
          otherComboTutors,
          piecesInCommandZone: combo.piecesInCommandZone,
          sharedComboPieces,
          comboPool: round2(pool),
        },
      };
    }
  }
  return best;
}

/**
 * Attribute the targeted-access score to its source. Purely descriptive — it
 * never affects the value, which stays max(general, combo).
 */
export function targetedAccessSource(
  general: number,
  combo: number,
): TargetedAccessSource {
  if (general <= 0 && combo <= 0) return 'none';
  if (general > combo) return 'general';
  if (combo > general) return 'combo';
  return 'both';
}

// ---------------------------------------------------------------------------
// Functional redundancy
// ---------------------------------------------------------------------------

/**
 * Support for one function or alternative group, deduplicated by physical
 * card: a card carrying two alternatives counts once toward that group.
 */
function groupSupport(
  tags: CardTag[],
  cardsByTag: Record<CardTag, string[]>,
): { support: number; perTag: Record<string, number> } {
  const names = new Set<string>();
  const perTag: Record<string, number> = {};
  for (const tag of tags) {
    const cards = cardsByTag[tag] ?? [];
    perTag[tag] = cards.length;
    for (const name of cards) names.add(name);
  }
  return { support: names.size, perTag };
}

function scoreRedundancy(
  composition: DeckComposition,
  primary: ArchetypeInferenceType | null,
): RedundancyComponent {
  const definition = primary ? FUNCTIONAL_MODEL[primary] : undefined;
  if (!primary || !definition) {
    return {
      score: 0,
      max: REDUNDANCY_MAX,
      raw: {
        primaryArchetype: primary ?? '(none)',
        reason: 'no functional model',
        base: 0,
        requiredScore: 0,
        totalOptional: 0,
      },
      functions: [],
      requiredCoverage: 0,
      completenessMultiplier: 0,
      optionalBonus: 0,
      optionalSaturation: 0,
      optionalCoverage: 0,
    };
  }

  const tagProfile = analyzeDeckTags(composition);
  const functions: FunctionSupport[] = [];

  for (const requirement of definition.required) {
    const tags = Array.isArray(requirement) ? requirement : [requirement];
    const { support, perTag } = groupSupport(tags, tagProfile.cardsByTag);
    functions.push({
      id: tags.join(' | '),
      tags,
      support,
      saturation: functionSaturation(support),
      covered: support > 0,
      kind: 'required',
      perTag,
    });
  }

  for (const tag of definition.optional) {
    const { support, perTag } = groupSupport([tag], tagProfile.cardsByTag);
    functions.push({
      id: tag,
      tags: [tag],
      support,
      saturation: functionSaturation(support),
      covered: support > 0,
      kind: 'optional',
      perTag,
    });
  }

  const required = functions.filter((f) => f.kind === 'required');
  /*
   * Optional functions are a capped BONUS on the required base, never part of
   * the mean. Averaging them in makes a weak optional actively lower the
   * score — a Tokens deck with one token_doubling would rank below the same
   * deck with none, penalising a real card. Absent optionals stay inert.
   */
  const activeOptional = functions.filter((f) => f.kind === 'optional' && f.support > 0);

  const totalOptional = functions.filter((f) => f.kind === 'optional').length;

  const base =
    required.length === 0
      ? 0
      : required.reduce((sum, f) => sum + f.saturation, 0) / required.length;

  const requiredCoverage =
    required.length === 0 ? 0 : required.filter((f) => f.covered).length / required.length;
  const completenessMultiplier = 0.5 + 0.5 * requiredCoverage;
  const requiredScore = REDUNDANCY_MAX * base * completenessMultiplier;

  /*
   * Two independent questions: how deep is each optional the deck actually
   * runs (saturation), and how many of the archetype's optionals it runs at
   * all (coverage). Coverage is what separates one shallow optional out of
   * three from three deep ones; averaging actives alone cannot see it.
   */
  const optionalSaturation =
    activeOptional.length === 0
      ? 0
      : activeOptional.reduce((sum, f) => sum + f.saturation, 0) / activeOptional.length;
  const optionalCoverage = totalOptional === 0 ? 0 : activeOptional.length / totalOptional;
  const optionalBonus = OPTIONAL_MAX * optionalSaturation * optionalCoverage;

  const score = clamp(requiredScore + optionalBonus, 0, REDUNDANCY_MAX);

  return {
    score,
    max: REDUNDANCY_MAX,
    raw: {
      primaryArchetype: primary,
      requiredFunctions: required.length,
      coveredRequired: required.filter((f) => f.covered).length,
      activeOptional: activeOptional.length,
      totalOptional,
      base: round2(base),
      requiredScore: round2(requiredScore),
    },
    functions,
    requiredCoverage: round2(requiredCoverage),
    completenessMultiplier: round2(completenessMultiplier),
    optionalBonus: round2(optionalBonus),
    optionalSaturation: round2(optionalSaturation),
    optionalCoverage: round2(optionalCoverage),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function collectLimitations(evidence: DeckPowerEvidence, primary: string | null): string[] {
  const limitations: string[] = [];
  const relevance = evidence.consistency.tutorRelevance;

  if (evidence.consistency.cardSelectionCount > 0) {
    limitations.push(
      'card selection is scored as one undifferentiated role: Phase 4A does not ' +
        "distinguish a repeatable selection engine from a one-shot cantrip",
    );
  }
  if (relevance.potentialTutorsForWin > 0) {
    limitations.push(
      `${relevance.potentialTutorsForWin} tutor(s) match only under an unevaluated ` +
        'numeric restriction; counted as potential, scored as zero',
    );
  }
  if (relevance.unsupportedConstraintTutors.length > 0) {
    limitations.push(
      `tutors with unsupported constraint semantics: ${relevance.unsupportedConstraintTutors.join(', ')}`,
    );
  }
  if (evidence.winPackage.partialComboCount > 0) {
    limitations.push(
      `${evidence.winPackage.partialComboCount} partial combo(s) present; diagnostic only, no combo access credit`,
    );
  }
  if (primary === null) {
    limitations.push('no primary archetype established, so functional redundancy scores zero');
  }
  /*
   * Always disclosed: these are properties of the model itself, not of any
   * particular deck, so they must not be conditional on the evidence.
   */
  limitations.push(
    'commanderAccess is binary: it does not distinguish incidental support ' +
      'from a central repeatable commander engine',
  );
  limitations.push(
    'permission-style recursion (e.g. Muldrotha, the Gravetide) is not represented by the ' +
      'primary-support tag vocabulary and can produce a commander-access false negative',
  );
  limitations.push(
    'mana reliability and colour fixing are excluded here; they belong to a future Mana Quality dimension',
  );
  return limitations;
}

/**
 * Score the CONSISTENCY dimension.
 *
 * Components sum to 100: targeted access 30, selection 20, card flow 15,
 * functional redundancy 25, commander access 10.
 */
export function scoreConsistency(
  composition: DeckComposition,
  evidence: DeckPowerEvidence,
  archetypes: DeckArchetypeProfile,
): ConsistencyDimension {
  const relevance = evidence.consistency.tutorRelevance;
  const primary =
    archetypes.inferences
      .filter((i) => i.anchorSatisfied)
      .sort((a, b) => b.score - a.score)[0]?.archetype ?? null;

  // --- targeted access: general and combo folded with max(), never summed ---
  const general = scoreGeneralAccess(relevance.tutors);
  const combo = scoreComboAccess(
    evidence.winPackage.combos,
    relevance.tutors,
    evidence.winPackage.sharedComboPieces,
  );
  const source = targetedAccessSource(general.score, combo.score);
  const targetedAccess: ConsistencyComponent = {
    score: Math.max(general.score, combo.score),
    max: TARGETED_ACCESS_MAX,
    raw: {
      ...general.raw,
      ...combo.raw,
      generalAccess: round2(general.score),
      comboAccess: round2(combo.score),
      source,
      potentialOnlyTutors: relevance.potentialTutorsForWin,
    },
  };

  // --- selection ----------------------------------------------------------
  const selectionCount = evidence.consistency.cardSelectionCount;
  const selection: ConsistencyComponent = {
    score: saturating(selectionCount, SELECTION_MAX, 6),
    max: SELECTION_MAX,
    raw: { cardSelectionCount: selectionCount },
  };

  /*
   * --- card flow ---------------------------------------------------------
   * One disjoint weighted pool, so a single physical card contributes once.
   * Rhystic Study is efficient AND repeatable: it counts 2.5 once, not as
   * three separate full-strength sources.
   */
  const ca = evidence.cardAdvantage;
  const both = ca.efficientAndRepeatableCount;
  const efficientOnly = Math.max(0, ca.efficientCardAdvantageCount - both);
  const repeatableOnly = Math.max(0, ca.repeatableCardAdvantageCount - both);
  const plainOnly = Math.max(
    0,
    ca.cardAdvantageCount - ca.efficientCardAdvantageCount - ca.repeatableCardAdvantageCount + both,
  );
  const flowPool = 2.5 * both + 1.5 * efficientOnly + 1 * repeatableOnly + 0.5 * plainOnly;
  const cardFlow: ConsistencyComponent = {
    score: saturating(flowPool, CARD_FLOW_MAX, 5),
    max: CARD_FLOW_MAX,
    raw: {
      total: ca.cardAdvantageCount,
      efficient: ca.efficientCardAdvantageCount,
      repeatable: ca.repeatableCardAdvantageCount,
      efficientAndRepeatable: both,
      efficientOnly,
      repeatableOnly,
      plainOnly,
      weightedPool: round2(flowPool),
    },
  };

  // --- functional redundancy (mainboard + commanders via tag profile) ------
  const redundancy = scoreRedundancy(composition, primary);

  /*
   * --- commander access ---------------------------------------------------
   * Flat: the commander begins in the command zone, so supplying the engine
   * is inherently reliable access. Redundancy is deliberately NOT considered
   * here — penalising commander dependence belongs to Resilience.
   *
   * Deliberately BINARY. A graded 0/1/2 model was evaluated against all nine
   * real fixtures and rejected: tag-overlap depth is not a proxy for
   * centrality (Purphoros matches 1/3 tags and is the deck's whole engine),
   * and Muldrotha matches 0/3 while being a textbook always-available engine.
   * Grading repeatability would require new Oracle-text classification inside
   * this scorer, which Phase 4B.2 forbids. Both gaps are disclosed as
   * limitations rather than papered over with a heuristic.
   */
  const providesEngine = evidence.consistency.commanderProvidesPrimaryEngine;
  const commanderAccess: ConsistencyComponent = {
    score: providesEngine ? COMMANDER_ACCESS_MAX : 0,
    max: COMMANDER_ACCESS_MAX,
    raw: {
      commanderProvidesPrimaryEngine: providesEngine,
      commanderPrimaryTags: evidence.commanderEngine.commanderPrimaryTags.join(',') || '(none)',
      mainboardRedundantEngineCount: evidence.commanderEngine.mainboardRedundantEngineCount,
    },
  };

  const score = clamp(
    targetedAccess.score + selection.score + cardFlow.score + redundancy.score + commanderAccess.score,
    0,
    100,
  );

  return {
    score: round2(score),
    rating: ratingFor(score),
    targetedAccess: { ...targetedAccess, score: round2(targetedAccess.score) },
    selection: { ...selection, score: round2(selection.score) },
    cardFlow: { ...cardFlow, score: round2(cardFlow.score) },
    redundancy: {
      ...redundancy,
      score: round2(redundancy.score),
      functions: redundancy.functions.map((f) => ({ ...f, saturation: round2(f.saturation) })),
    },
    commanderAccess,
    limitations: collectLimitations(evidence, primary),
  };
}
