import { scoreSpeed } from './speed';
import { scoreConsistency } from './consistency';
import { scoreInteraction } from './interaction';
import { scoreResilience } from './resilience';
import type { DeckPowerEvidence } from './powerEvidence';
import type { DeckArchetypeProfile, DeckComposition } from './types';

/**
 * Phase 4C — COMPOSITE POWER INDEX. Pure.
 *
 * An UNCALIBRATED deterministic composite of the four frozen Phase 4B
 * dimensions: Speed, Consistency, Interaction, Resilience.
 *
 * The four-dimensional profile is the PRIMARY interpretation of a deck. This
 * index is a compact summary of that profile and must never replace or obscure
 * it, which is why `dimensions` is always echoed alongside the score.
 *
 *     Power Profile
 *       - Speed
 *       - Consistency
 *       - Interaction
 *       - Resilience
 *
 *     Composite Power Index
 *       - geometric summary of the four frozen dimensions
 *
 * Deliberately NOT called a power level, an absolute power score, or a
 * calibrated measurement. A cross-dimension commensurability audit established
 * that the four scales are not fully ratio-comparable: the Speed model has a
 * structurally lower attainable ceiling for non-combo decks (about 69) than
 * Consistency, Interaction and Resilience, because its non-combo win-speed base
 * is capped before bonuses. The index is therefore an internal COMPARATIVE
 * index, not an absolute one. That is a calibration limitation, reported in
 * `limitations`, and deliberately not hidden behind an unvalidated rescaling.
 *
 * The four dimension scores are consumed AS EMITTED. Each scorer already
 * decided how to handle its own missing evidence, and that decision lives
 * inside its frozen contract: re-interpreting a zero or renormalising around an
 * unavailable subcomponent here would silently override it. Unavailable states
 * reach the caller through the dimensions' own diagnostics and through
 * `limitations`, never through the arithmetic.
 */

export type DimensionName = 'speed' | 'consistency' | 'interaction' | 'resilience';

export interface CompositeDimensionScores {
  speed: number;
  consistency: number;
  interaction: number;
  resilience: number;
}

export interface CompositePowerDiagnostics {
  /** The dimension constraining the aggregate most. */
  minimumDimension: DimensionName;
  minimumScore: number;
  /** Arithmetic mean, for comparison only. Never part of the score. */
  arithmeticMean: number;
}

export interface CompositePowerIndex {
  score: number;
  dimensions: CompositeDimensionScores;
  diagnostics: CompositePowerDiagnostics;
  limitations: string[];
}

const DIMENSION_ORDER: readonly DimensionName[] = [
  'speed',
  'consistency',
  'interaction',
  'resilience',
];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Geometric mean of the four dimension scores.
 *
 * Chosen because it treats the dimensions as partially complementary rather
 * than fully substitutable: a severe weakness meaningfully constrains the total
 * without an arbitrary weakest-link multiplier or tuning constant. The
 * arithmetic mean ranks 80/80/80/10 above 60/60/60/60, which would assert that
 * a near-absent capacity is fully purchasable with excess elsewhere.
 *
 * A true zero in any dimension yields zero. That is deliberate and NOT
 * softened with an epsilon: a dimension the deck genuinely cannot do at all is
 * a catastrophic weakness, and the aggregate should say so rather than hide it.
 *
 * This is a semantic design choice. The nine-deck corpus spans only 8.2 points
 * and did not statistically identify the geometric mean as optimal.
 */
export function geometricMean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  if (values.some((v) => v <= 0)) return 0;
  // Summed logs rather than a raw product: four values near 100 would otherwise
  // multiply to 1e8 before the root, needlessly courting precision loss.
  const meanLog = values.reduce((sum, v) => sum + Math.log(v), 0) / values.length;
  return Math.exp(meanLog);
}

function collectLimitations(): string[] {
  return [
    'this is an UNCALIBRATED composite index, not an absolute power measurement: ' +
      'no rating band, power level, or casual/high-power/cEDH label is emitted',
    'the four dimension scales are not fully ratio-comparable: the Speed model ' +
      'has a structurally lower attainable ceiling for non-combo decks (about 69) ' +
      'than Consistency, Interaction and Resilience, so the index under-weights ' +
      'Speed strength relative to the other three',
    'rankings are indicative rather than settled: several real fixtures sit within ' +
      'about 1.5 composite points and reorder under modest hypothetical ' +
      'recalibration of any single dimension',
    'the aggregation family (geometric mean) was chosen semantically, not ' +
      'statistically calibrated: the real-deck corpus spans about 8 points and ' +
      'cannot distinguish between aggregation families',
    'the real-deck corpus is small (n=9) and contains no validated cEDH or ' +
      'precon reference decks',
    'no matchup-specific modelling: there is no opponent model, so this is a ' +
      'deck-intrinsic assessment only',
    'unavailable subcomponents inside a dimension (a null Speed win line, a ' +
      'missing Consistency functional model, an unknown Resilience commander ' +
      'backup) are reported by that dimension and deliberately do NOT alter the ' +
      'aggregation',
    'the four-dimensional profile is the primary interpretation; this index is a ' +
      'compact summary of it and does not replace it',
  ];
}

/**
 * Aggregate four already-computed dimension scores.
 *
 * Exposed separately from `assessCompositePower` so the aggregation can be
 * tested against score vectors directly, without constructing a deck.
 */
export function aggregateDimensions(
  dimensions: CompositeDimensionScores,
): CompositePowerIndex {
  const scores: CompositeDimensionScores = {
    speed: clamp(dimensions.speed, 0, 100),
    consistency: clamp(dimensions.consistency, 0, 100),
    interaction: clamp(dimensions.interaction, 0, 100),
    resilience: clamp(dimensions.resilience, 0, 100),
  };

  const values = DIMENSION_ORDER.map((d) => scores[d]);
  const minimumDimension = DIMENSION_ORDER.reduce((lowest, d) =>
    scores[d] < scores[lowest] ? d : lowest,
  );

  return {
    score: round2(geometricMean(values)),
    dimensions: scores,
    diagnostics: {
      minimumDimension,
      minimumScore: round2(scores[minimumDimension]),
      arithmeticMean: round2(values.reduce((a, b) => a + b, 0) / values.length),
    },
    limitations: collectLimitations(),
  };
}

/**
 * Compute a deck's Composite Power Index by running the four frozen dimensions
 * and aggregating their emitted scores.
 *
 * The individual dimension objects are deliberately NOT re-exposed here: the
 * caller already has them, or can call the scorers directly, and duplicating
 * every component internal inside this shape would create two sources of truth.
 */
export function assessCompositePower(
  composition: DeckComposition,
  evidence: DeckPowerEvidence,
  archetypes: DeckArchetypeProfile,
): CompositePowerIndex {
  return aggregateDimensions({
    speed: scoreSpeed(composition, evidence, archetypes).score,
    consistency: scoreConsistency(composition, evidence, archetypes).score,
    interaction: scoreInteraction(composition, evidence).score,
    resilience: scoreResilience(composition, evidence, archetypes).score,
  });
}
