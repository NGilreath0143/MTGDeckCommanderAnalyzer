import { isLand } from './cardFacts';
import { classifyCardRoles } from './roles';
import type { DetectedCombo, WinRequirement } from './knownCombos';
import type { DeckPowerEvidence } from './powerEvidence';
import type { TutorTarget } from './tutorRelevance';
import type {
  ArchetypeInferenceType,
  DeckArchetypeProfile,
  DeckComposition,
} from './types';

/**
 * Phase 4B.1 — the SPEED power dimension. Pure.
 *
 * Answers "how quickly can this deck develop meaningful resources and progress
 * toward a position from which it can realistically win?"
 *
 * Speed CONSUMES Phase 4A evidence and never reclassifies cards. The one
 * derivation performed here is splitting cheap plays into proactive vs
 * reactive, which reuses existing Phase 2 roles rather than reading oracle text.
 *
 * This is a comparative dimension, NOT a game simulator: it deliberately
 * produces no turn-to-win estimate.
 */

export type SpeedRating = 'low' | 'moderate' | 'good' | 'high' | 'elite';

/** One scored component with the raw evidence that produced it. */
export interface SpeedComponent {
  score: number;
  max: number;
  raw: Record<string, number | boolean | string>;
}

export interface DevelopmentSpeed {
  score: number;
  acceleration: SpeedComponent;
  curve: SpeedComponent;
  proactiveDevelopment: SpeedComponent;
  /** Negative: tapped lands slow the deck's first turns. */
  manaBaseFriction: SpeedComponent;
}

/** One candidate route to winning, scored independently. */
export interface WinSpeedLine {
  kind: 'combo' | 'archetype';
  id: string;
  score: number;
  raw: Record<string, number | boolean | string>;
}

export interface WinSpeed {
  score: number;
  /** The fastest available line; Speed uses the best, never the sum. */
  bestLine: WinSpeedLine | null;
  lines: WinSpeedLine[];
}

export interface SpeedDimension {
  score: number;
  rating: SpeedRating;
  development: DevelopmentSpeed;
  winSpeed: WinSpeed;
  /** Known evidence gaps affecting this deck's score. */
  limitations: string[];
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Diminishing returns: approaches `max` without ever reaching it. */
const saturating = (value: number, max: number, scale: number) =>
  value <= 0 ? 0 : max * (1 - Math.exp(-value / scale));

// ---------------------------------------------------------------------------
// Development Speed
// ---------------------------------------------------------------------------

const ACCELERATION_MAX = 45;
const CURVE_MAX = 25;
const PROACTIVE_MAX = 30;
const FRICTION_MAX = 12;

/** A fast-mana piece is worth this many ordinary ramp pieces. */
const FAST_MANA_WEIGHT = 2.5;

/**
 * Cheap plays that answer or find rather than develop.
 *
 * Reuses Phase 2 roles: a two-mana counterspell is capability, not proactive
 * development. Measured on fixtures this separates spellslinger (19 reactive
 * of 29 cheap plays) from lands-landfall (4 of 19).
 */
const REACTIVE_ROLES = ['interaction', 'protection', 'tutor', 'card_selection'] as const;

/**
 * Count cheap proactive plays and cheap reactive plays.
 *
 * Derived from existing role classification — no new oracle-text logic.
 */
function splitEarlyPlays(composition: DeckComposition): {
  proactive: number;
  reactive: number;
} {
  let proactive = 0;
  let reactive = 0;
  for (const { card, quantity } of composition.mainboard) {
    if (isLand(card) || Math.floor(card.cmc) > 2) continue;
    const roles = new Set(classifyCardRoles(card).assignments.map((a) => a.role));
    if (REACTIVE_ROLES.some((r) => roles.has(r))) reactive += quantity;
    else proactive += quantity;
  }
  return { proactive, reactive };
}

/**
 * How many cards are BOTH fast mana and ordinary ramp.
 *
 * Measured corpus-wide, 82% of fast mana also carries the ramp role, so
 * awarding both independently would double count acceleration.
 */
function fastRampOverlap(composition: DeckComposition, evidence: DeckPowerEvidence): number {
  const fastNames = new Set(
    evidence.cardProperties
      .filter((c) => c.property === 'fast_mana')
      .map((c) => c.name),
  );
  let overlap = 0;
  for (const { card, quantity } of composition.mainboard) {
    if (!fastNames.has(card.name)) continue;
    if (classifyCardRoles(card).assignments.some((a) => a.role === 'ramp')) overlap += quantity;
  }
  return overlap;
}

function scoreDevelopment(
  composition: DeckComposition,
  evidence: DeckPowerEvidence,
): DevelopmentSpeed {
  const { mana, manaBase } = evidence;

  // --- acceleration: one blended pool, so overlap is never counted twice ----
  const overlap = fastRampOverlap(composition, evidence);
  const ordinaryRamp = Math.max(0, mana.rampCount - overlap);
  const weighted = FAST_MANA_WEIGHT * mana.fastManaCount + ordinaryRamp;
  const acceleration: SpeedComponent = {
    score: saturating(weighted, ACCELERATION_MAX, 6),
    max: ACCELERATION_MAX,
    raw: {
      fastManaCount: mana.fastManaCount,
      rampCount: mana.rampCount,
      fastRampOverlap: overlap,
      ordinaryRampAfterOverlap: ordinaryRamp,
      weightedPool: round2(weighted),
    },
  };

  /*
   * --- curve ------------------------------------------------------------
   * A low curve helps but must not dominate, and a high curve creates
   * friction rather than an automatic penalty: strong acceleration can carry
   * an expensive deck, which the acceleration component already rewards.
   */
  const nonlandCount =
    mana.mv0 + mana.mv1 + mana.mv2 + mana.mv3 + mana.mv4 + mana.mv5 + mana.mv6Plus;
  const expensiveRatio = nonlandCount === 0 ? 0 : mana.expensiveCardCount / nonlandCount;
  const curveBase = CURVE_MAX * clamp((3.6 - mana.averageManaValue) / 1.8, 0, 1);
  const curve: SpeedComponent = {
    score: curveBase * (1 - 0.4 * expensiveRatio),
    max: CURVE_MAX,
    raw: {
      averageManaValue: mana.averageManaValue,
      medianManaValue: mana.medianManaValue,
      expensiveCardCount: mana.expensiveCardCount,
      expensiveRatio: round2(expensiveRatio),
      curveBeforeExpensivePenalty: round2(curveBase),
    },
  };

  /*
   * --- proactive development ---------------------------------------------
   * Only cheap plays that actually advance the deck's own board or engine.
   * Using the proactive subset (rather than earlyPlayCount) is what stops a
   * cheap reactive pile from reading as a fast start, and it also avoids
   * double counting with the curve component, which already reads average MV.
   */
  const { proactive, reactive } = splitEarlyPlays(composition);
  const proactiveDevelopment: SpeedComponent = {
    score: saturating(proactive, PROACTIVE_MAX, 10),
    max: PROACTIVE_MAX,
    raw: {
      earlyPlayCount: mana.earlyPlayCount,
      proactiveEarlyPlays: proactive,
      reactiveEarlyPlays: reactive,
    },
  };

  /*
   * --- mana-base friction -------------------------------------------------
   * Modest by design: mana-base quality will get its own dimension later.
   * Conditional lands count half, since they are often untapped in practice.
   */
  const effectiveTapped = manaBase.entersTappedLandCount + 0.5 * manaBase.conditionalUntappedLandCount;
  const tappedRatio = manaBase.landCount === 0 ? 0 : effectiveTapped / manaBase.landCount;
  const manaBaseFriction: SpeedComponent = {
    score: -FRICTION_MAX * clamp(tappedRatio / 0.35, 0, 1),
    max: FRICTION_MAX,
    raw: {
      entersTappedLandCount: manaBase.entersTappedLandCount,
      conditionalUntappedLandCount: manaBase.conditionalUntappedLandCount,
      landCount: manaBase.landCount,
      effectiveTappedRatio: round2(tappedRatio),
    },
  };

  const score = clamp(
    acceleration.score + curve.score + proactiveDevelopment.score + manaBaseFriction.score,
    0,
    100,
  );

  return {
    score: round2(score),
    acceleration: { ...acceleration, score: round2(acceleration.score) },
    curve: { ...curve, score: round2(curve.score) },
    proactiveDevelopment: { ...proactiveDevelopment, score: round2(proactiveDevelopment.score) },
    manaBaseFriction: { ...manaBaseFriction, score: round2(manaBaseFriction.score) },
  };
}

// ---------------------------------------------------------------------------
// Win Speed
// ---------------------------------------------------------------------------

/** A deterministic win is faster than an unbounded resource loop. */
const COMBO_BASE: Readonly<Record<string, number>> = {
  immediate_win: 70,
  deterministic_win: 70,
  infinite_mana: 55,
  infinite_damage: 55,
  infinite_etb: 55,
  infinite_ltb: 55,
  infinite_resource: 55,
  deck_loop: 55,
  major_advantage: 40,
  other: 35,
};

/** Fewer moving pieces is faster, all else equal. */
function comboSizeMultiplier(size: number): number {
  if (size <= 2) return 1;
  if (size === 3) return 0.85;
  return 0.72;
}

/**
 * Objective setup friction. An infinite-mana combo still needs a sink, which
 * is why `additional_outlet` is the harshest multiplier here.
 */
const REQUIREMENT_MULTIPLIER: Readonly<Record<WinRequirement, number>> = {
  library: 1.0,
  mana: 0.92,
  life_total: 0.95,
  graveyard: 0.88,
  board_state: 0.85,
  additional_outlet: 0.8,
  combat: 0.78,
  delayed_trigger: 0.75,
  other: 0.9,
};

/** Does this tutor have at least one EXACT match among the given card names? */
function tutorFindsExact(tutor: TutorTarget, names: ReadonlySet<string>): boolean {
  return tutor.findsComboPieces.some(
    (m) => m.confidence === 'exact' && names.has(m.cardName),
  );
}

const WIN_TUTOR_ACCESS_MAX = 10;
const ENGINE_TUTOR_ACCESS_MAX = 4;
const COMBO_TUTOR_ACCESS_MAX = 10;
/** An efficient tutor is worth this many ordinary ones. */
const EFFICIENT_TUTOR_WEIGHT = 3;

/** Command-zone access makes a combo materially more reachable. */
const COMMAND_ZONE_BONUS_PER_PIECE = 8;
const COMMAND_ZONE_BONUS_MAX = 12;

function scoreComboLine(combo: DetectedCombo, tutors: readonly TutorTarget[]): WinSpeedLine {
  const base = COMBO_BASE[combo.result] ?? 35;
  const sizeMultiplier = comboSizeMultiplier(combo.comboSize);
  const setupMultiplier = combo.requirements.reduce(
    (product, r) => product * (REQUIREMENT_MULTIPLIER[r] ?? 0.9),
    1,
  );
  /*
   * Printed mana burden. Deliberately gentle, because Phase 4A preserves
   * Scryfall X semantics: Walking Ballista reports MV 0 while really needing
   * {X}{X}. Speed must not read that as free, so this term never rewards a
   * low printed value — it only penalises a high one.
   */
  const manaMultiplier = 1 - clamp((combo.totalPrintedManaValue - 4) / 10, 0, 0.25);
  const commandZoneBonus = Math.min(
    COMMAND_ZONE_BONUS_MAX,
    COMMAND_ZONE_BONUS_PER_PIECE * combo.piecesInCommandZone,
  );

  /*
   * Tutor access for THIS combo: a tutor counts once per combo even when it
   * can find several of its pieces, and only exact matches qualify. Generic
   * tutor count is never used — an Enlightened Tutor cannot find Thassa's
   * Oracle, so it contributes nothing here.
   */
  const comboPieceNames = new Set(combo.pieces.map((p) => p.name));
  const relevantTutors = tutors.filter((t) => tutorFindsExact(t, comboPieceNames));
  const efficientComboTutors = relevantTutors.filter((t) => t.efficient).length;
  const otherComboTutors = relevantTutors.length - efficientComboTutors;
  const comboTutorAccess = Math.min(
    COMBO_TUTOR_ACCESS_MAX,
    EFFICIENT_TUTOR_WEIGHT * efficientComboTutors + otherComboTutors,
  );

  const score = clamp(
    base * sizeMultiplier * setupMultiplier * manaMultiplier +
      commandZoneBonus +
      comboTutorAccess,
    0,
    100,
  );

  return {
    kind: 'combo',
    id: combo.id,
    score: round2(score),
    raw: {
      result: combo.result,
      base,
      comboSize: combo.comboSize,
      sizeMultiplier,
      requirements: combo.requirements.join(',') || '(none)',
      setupMultiplier: round2(setupMultiplier),
      totalPrintedManaValue: combo.totalPrintedManaValue,
      manaMultiplier: round2(manaMultiplier),
      piecesInCommandZone: combo.piecesInCommandZone,
      commandZoneBonus,
      exactEfficientComboTutors: efficientComboTutors,
      exactOtherComboTutors: otherComboTutors,
      comboTutorAccess,
      comboTutorNames: relevantTutors.map((t) => t.tutorName).join(',') || '(none)',
    },
  };
}

/**
 * Archetypes whose plan closes a game through combat.
 *
 * Deliberately narrow: Tokens qualifies only when Go-Wide independently
 * satisfied its own anchor, because making tokens is not the same as
 * converting them into lethal pressure.
 */
const COMBAT_CLOSING_ARCHETYPES: ReadonlySet<ArchetypeInferenceType> = new Set([
  'go_wide',
  'voltron',
  'aura_voltron',
]);

/*
 * Archetype coherence is evidence that a deck HAS a plan, not that the plan
 * closes quickly, so the non-combo base is deliberately modest.
 */
const ARCHETYPE_BASE_MIN = 10;
const ARCHETYPE_BASE_RANGE = 20;
/**
 * Reduced from the originally proposed +18 because the Phase 4A
 * win_condition list covers only nine cards. Absence of a curated finisher
 * must never be read as absence of a real one.
 */
const ALIGNED_FINISHER_BONUS = 8;
const COMBAT_CLOSING_BONUS = 10;
const ALIGNMENT_MAX = 12;

function scoreArchetypeLine(
  archetypes: DeckArchetypeProfile,
  evidence: DeckPowerEvidence,
): WinSpeedLine | null {
  const satisfied = archetypes.inferences
    .filter((i) => i.anchorSatisfied)
    .sort((a, b) => b.score - a.score);
  const primary = satisfied[0];
  if (!primary) return null;

  const base = ARCHETYPE_BASE_MIN + ARCHETYPE_BASE_RANGE * (primary.score / 100);

  /*
   * Aligned finishers come from Phase 4A evidence, which tests whether a
   * recognised win condition's own strategy tags overlap the tags supporting
   * the primary archetype. Speed performs no card classification of its own.
   */
  const alignedFinishers = evidence.winPackage.alignedWinConditions.filter((w) => w.aligned);
  const unalignedFinishers = evidence.winPackage.alignedWinConditions.filter((w) => !w.aligned);
  const finisherBonus = alignedFinishers.length > 0 ? ALIGNED_FINISHER_BONUS : 0;

  // Combat closing requires an archetype that actually converts board to damage.
  const combatClosing = satisfied.some((i) => COMBAT_CLOSING_ARCHETYPES.has(i.archetype));
  const combatBonus = combatClosing && finisherBonus === 0 ? COMBAT_CLOSING_BONUS : 0;

  const alignmentScore = saturating(
    evidence.consistency.primaryStrategyFunctionalSupport,
    ALIGNMENT_MAX,
    12,
  );

  /*
   * Tutor access, from EXACT matches only. Potential matches (unevaluated
   * numeric restrictions such as Sunforger's) stay diagnostic.
   */
  const relevance = evidence.consistency.tutorRelevance;
  const winTutors = relevance.relevantTutorsForWin;
  const winEfficientTutors = relevance.relevantEfficientTutorsForWin;
  const winTutorAccess = Math.min(
    WIN_TUTOR_ACCESS_MAX,
    EFFICIENT_TUTOR_WEIGHT * winEfficientTutors + (winTutors - winEfficientTutors),
  );

  /*
   * Engine access is smaller and must not double count: a tutor already
   * credited for finding a win condition cannot also be credited here.
   */
  const engineOnlyTutors = relevance.tutors.filter((t) => {
    const findsEngine = t.findsPrimaryEngine.some((m) => m.confidence === 'exact');
    if (!findsEngine) return false;
    const findsWin =
      t.findsWinConditions.some((m) => m.confidence === 'exact') ||
      t.findsComboPieces.some((m) => m.confidence === 'exact');
    return !findsWin;
  }).length;
  const engineTutorAccess = Math.min(ENGINE_TUTOR_ACCESS_MAX, engineOnlyTutors);

  const score = clamp(
    base + finisherBonus + combatBonus + alignmentScore + winTutorAccess + engineTutorAccess,
    0,
    100,
  );

  return {
    kind: 'archetype',
    id: primary.archetype,
    score: round2(score),
    raw: {
      archetypeScore: primary.score,
      base: round2(base),
      alignedFinishers:
        alignedFinishers.map((w) => `${w.name}[${w.sharedTags.join('+')}]`).join(',') || '(none)',
      unalignedWinConditions:
        unalignedFinishers.map((w) => `${w.name}[${w.cardTags.join('+') || 'no tags'}]`).join(',') ||
        '(none)',
      finisherBonus,
      combatClosingArchetype: combatClosing,
      combatBonus,
      primaryStrategyFunctionalSupport: evidence.consistency.primaryStrategyFunctionalSupport,
      alignmentScore: round2(alignmentScore),
      relevantTutorsForWin: winTutors,
      relevantEfficientTutorsForWin: winEfficientTutors,
      winTutorAccess,
      engineOnlyTutors,
      engineTutorAccess,
    },
  };
}

function scoreWinSpeed(
  evidence: DeckPowerEvidence,
  archetypes: DeckArchetypeProfile,
): WinSpeed {
  const lines: WinSpeedLine[] = [];
  const tutors = evidence.consistency.tutorRelevance.tutors;

  // Only COMPLETE combos are a win line. Partial packages are progress, not a
  // route to victory, and contribute nothing here.
  for (const combo of evidence.winPackage.combos) {
    if (!combo.complete) continue;
    lines.push(scoreComboLine(combo, tutors));
  }

  const archetypeLine = scoreArchetypeLine(archetypes, evidence);
  if (archetypeLine) lines.push(archetypeLine);

  // The deck is as fast as its fastest route, never the sum of its routes.
  const bestLine = lines.reduce<WinSpeedLine | null>(
    (best, line) => (best === null || line.score > best.score ? line : best),
    null,
  );

  return { score: bestLine ? bestLine.score : 0, bestLine, lines };
}

// ---------------------------------------------------------------------------
// Combination and rating
// ---------------------------------------------------------------------------

const WIN_SPEED_WEIGHT = 0.6;
const DEVELOPMENT_WEIGHT = 0.4;

export function ratingFor(score: number): SpeedRating {
  if (score < 25) return 'low';
  if (score < 45) return 'moderate';
  if (score < 65) return 'good';
  if (score < 80) return 'high';
  return 'elite';
}

/**
 * Known evidence gaps, surfaced per deck so a score is never read as more
 * precise than the evidence behind it.
 */
function collectLimitations(
  evidence: DeckPowerEvidence,
  winSpeed: WinSpeed,
): string[] {
  const limitations: string[] = [];

  if (evidence.winPackage.winConditionCount === 0 && winSpeed.bestLine?.kind === 'archetype') {
    limitations.push(
      'no curated win_condition matched; the nine-card Phase 4A list is incomplete, ' +
        'so a real finisher may exist but be unrecognised',
    );
  }
  if (evidence.consistency.efficientTutorCount > 0) {
    limitations.push(
      `${evidence.consistency.efficientTutorCount} efficient tutor(s) present but not scored: ` +
        'Phase 4A cannot yet show whether a tutor finds a relevant piece',
    );
  }
  if (evidence.winPackage.partialComboCount > 0) {
    limitations.push(
      `${evidence.winPackage.partialComboCount} partial combo(s) present; not scored as a win line`,
    );
  }
  for (const combo of evidence.winPackage.combos) {
    if (combo.complete && combo.pieces.some((p) => p.printedManaValue === 0)) {
      limitations.push(
        `${combo.id} contains an X-cost piece reporting printed MV 0; real activation ` +
          'mana is not expressible in current evidence',
      );
    }
  }
  return limitations;
}

/**
 * Score the SPEED dimension.
 *
 * Win Speed is weighted higher than Development because converting a position
 * into a win is what "fast" ultimately means, but development gates execution:
 * a compact combo in a deck that cannot cast it is not fast.
 */
export function scoreSpeed(
  composition: DeckComposition,
  evidence: DeckPowerEvidence,
  archetypes: DeckArchetypeProfile,
): SpeedDimension {
  const development = scoreDevelopment(composition, evidence);
  const winSpeed = scoreWinSpeed(evidence, archetypes);

  const weighted =
    DEVELOPMENT_WEIGHT * development.score + WIN_SPEED_WEIGHT * winSpeed.score;
  // Execution gate: poor development throttles even a perfect win package.
  const gate = 0.75 + 0.25 * (development.score / 100);
  const score = clamp(weighted * gate, 0, 100);

  return {
    score: round2(score),
    rating: ratingFor(score),
    development,
    winSpeed,
    limitations: collectLimitations(evidence, winSpeed),
  };
}
