/**
 * Phase 5A calibration pilot — shared shapes. Dev-only.
 *
 * The pilot exists to test the METHODOLOGY, not the model: it measures how
 * long labelling takes and which rubric items raters can apply consistently.
 * With 12 decks and 3 raters it can say nothing about model accuracy, and the
 * tooling deliberately provides no way to compute that.
 */

/** Opaque per-deck identifier. Never encodes the commander or archetype. */
export type DeckId = string;
/** Pseudonymous rater identifier. */
export type RaterId = string;

export type DeckSource =
  | 'precon'
  | 'community'
  | 'tournament'
  | 'cedh_list'
  | 'synthetic';

/**
 * The believed power tier, used ONLY to check corpus coverage and to select
 * anchors. Never shown to raters and never treated as a label: a curator's
 * guess is not evidence.
 */
export type BelievedTier =
  | 'precon'
  | 'casual'
  | 'focused'
  | 'optimized'
  | 'high_power'
  | 'cedh'
  | 'incoherent';

export interface DeckMeta {
  id: DeckId;
  commander: string;
  source: DeckSource;
  believedTier: BelievedTier;
  /** Free-form archetype notes, curator-facing only. */
  archetypeNotes: string;
  /** Anchors appear in every rater's set and carry a higher rater minimum. */
  anchor: boolean;
  split: 'calibration' | 'holdout';
  decklistVersion: string;
}

// ---------------------------------------------------------------------------
// Rubric
// ---------------------------------------------------------------------------

/**
 * Nine items, deliberately NOT a restatement of the model.
 *
 * Tutor density and mana efficiency were considered and dropped: the model
 * already counts them mechanically, so asking a human to recount them produces
 * agreement by construction that would look like validation without being any.
 *
 * cEDH staple density was dropped for a different reason — it is mechanically
 * derivable from a card list, so a human should not spend judgment on it. If
 * it proves useful it can be computed AFTER the blind labels are frozen, which
 * also keeps competitive-tier vocabulary out of the rater's field of view.
 *
 * What remains: earliest and typical win turn, free interaction, ability to
 * stop a win, wipe recovery, win-plan compactness, deterministic combo,
 * commander dependence, and self-confidence. Items 2, 4, 5 and 8 are partially
 * independent observations, which is the point of collecting a rubric
 * alongside pairwise judgments.
 */
export interface RubricResponse {
  /** Earliest realistic turn this deck could win, assuming good draws. */
  earliestWinTurn: number;
  /** The turn it usually threatens to win. */
  typicalWinTurn: number;
  /** Cards castable without paying mana that answer an opponent. */
  freeInteractionCount: number;
  /** Could it stop another deck's win attempt? 0 = never, 4 = reliably. */
  canStopAWin: 0 | 1 | 2 | 3 | 4;
  /** Could it rebuild after a board wipe? 0 = never, 4 = easily. */
  recoversFromWipe: 0 | 1 | 2 | 3 | 4;
  /** Cards that must come together for its main win. */
  winPlanCardsNeeded: number;
  deterministicComboPresent: boolean;
  /** 0 = plan ignores the commander, 4 = plan collapses without it. */
  commanderDependence: 0 | 1 | 2 | 3 | 4;
  /**
   * How confident the rater is in their own judgment of this deck.
   *
   * The single highest-value item and the one most often omitted. It separates
   * "the model disagrees with a confident consensus" from "the model disagrees
   * with a guess", which are entirely different findings.
   */
  selfConfidence: 1 | 2 | 3 | 4 | 5;
}

export interface DeckLabel {
  deckId: DeckId;
  raterId: RaterId;
  rubric: RubricResponse;
  /** Minutes spent, for the pilot's burden measurement. */
  minutesSpent?: number;
}

// ---------------------------------------------------------------------------
// Pairwise
// ---------------------------------------------------------------------------

/**
 * One comparison. A tie is a real answer, not a missing one: a high tie rate
 * on a pair is itself the finding that any model gap there is not meaningful.
 */
export interface PairwiseJudgment {
  a: DeckId;
  b: DeckId;
  /** 'a' | 'b' = that deck is stronger. 'tie' = too close to call. */
  winner: 'a' | 'b' | 'tie';
  raterId: RaterId;
}

export interface RaterBundle {
  raterId: RaterId;
  /** Deck order is randomised per rater to avoid presentation-order priming. */
  deckOrder: DeckId[];
  pairs: { a: DeckId; b: DeckId }[];
}
