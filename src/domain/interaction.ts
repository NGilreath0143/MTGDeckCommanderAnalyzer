import { classifyCardRoles } from './roles';
import { analyzeCardPower, type InteractionTarget } from './powerCards';
import type { DeckPowerEvidence } from './powerEvidence';
import type { CardRole, DeckComposition, ResolvedCard } from './types';

/**
 * Phase 4B.3 — the INTERACTION power dimension. Pure.
 *
 * Answers "how effectively can this deck disrupt opposing threats, plans, and
 * win attempts across relevant zones and permanent types?"
 *
 * Interaction CONSUMES Phase 4A evidence and never classifies cards. It reads
 * roles and power properties per card only to place each PHYSICAL card in
 * exactly one availability/efficiency bucket — a bucketing question, not a
 * classification one. No Oracle text is inspected here.
 *
 * Three concepts are kept deliberately separate, because they answer different
 * questions and a flexible card should not become several independent answers:
 *   - physical density  (how many cards do I actually draw?)
 *   - efficiency        (what do they cost me?)
 *   - capability        (what can I answer?)
 *
 * Cross-component overlap is intentional and is NOT deduplicated: a free
 * counterspell is genuinely a physical answer, efficient, and stack capability
 * at once. Deduplication happens only WITHIN a component, where two evidence
 * fields would otherwise measure the same thing twice.
 */

export type InteractionRating = 'low' | 'moderate' | 'good' | 'high' | 'elite';

export interface InteractionComponent {
  score: number;
  max: number;
  raw: Record<string, number | boolean | string>;
}

export interface CoverageDetail {
  category: InteractionTarget;
  covered: boolean;
  /** Interaction cards touching this category; presence is what scores. */
  support: number;
  weight: number;
}

export interface CoverageComponent extends InteractionComponent {
  categories: CoverageDetail[];
}

export interface InteractionDimension {
  score: number;
  rating: InteractionRating;
  availability: InteractionComponent;
  efficiency: InteractionComponent;
  coverage: CoverageComponent;
  stack: InteractionComponent;
  stax: InteractionComponent;
  graveyard: InteractionComponent;
  boardReset: InteractionComponent;
  limitations: string[];
}

// ---------------------------------------------------------------------------
// Weights and maxima
// ---------------------------------------------------------------------------

const AVAILABILITY_MAX = 25;
const EFFICIENCY_MAX = 25;
const COVERAGE_MAX = 15;
const STACK_MAX = 15;
const STAX_MAX = 10;
const GRAVEYARD_MAX = 5;
const BOARD_RESET_MAX = 5;

/** Reference deck size used to normalise density; never hardcoded at a call site. */
const REFERENCE_DECK_SIZE = 99;

/**
 * Availability weights. A board wipe is real interaction but is not
 * interchangeable with instant-speed targeted removal; graveyard hate is
 * important but specialised.
 */
const WEIGHT_TARGETED = 1.0;
const WEIGHT_WIPE = 0.6;
const WEIGHT_GY_HATE_ONLY = 0.4;

/** Efficiency weights: free > efficient non-free > generic. */
const WEIGHT_FREE = 3.0;
const WEIGHT_EFFICIENT = 1.8;
const WEIGHT_GENERIC = 0.6;

/**
 * How much GENERIC efficiency credit a card earns, by why it entered the pool.
 *
 * Mirrors the availability weights. Availability already discounts a card that
 * is only a wipe or only graveyard hate, but efficiency previously paid every
 * interacting card full cost-tier credit — so a pile of narrow specialists
 * generated substantial generic efficiency on top of its own specialised
 * component. Overlap across components is intentional; unweighted overlap is
 * not.
 *
 * Applied ONLY when the specialist property is the sole reason for admission.
 * A card that independently carries the `interaction` role keeps full credit
 * even when it is also a wipe or graveyard hate: Cyclonic Rift and Farewell
 * are ordinary interaction that happens to sweep.
 */
const SPECIALIST_EFFICIENCY_WEIGHT_WIPE = 0.6;
const SPECIALIST_EFFICIENCY_WEIGHT_GY_HATE = 0.4;

/** Stack weights, mirroring the efficiency ladder. */
const WEIGHT_FREE_COUNTER = 3.0;
const WEIGHT_EFFICIENT_COUNTER = 1.8;
const WEIGHT_GENERIC_COUNTER = 0.8;

/**
 * Coverage category weights.
 *
 * `planeswalker` and `land` are deliberately near-zero. Phase 4A expands a
 * modal "target nonland permanent" answer into all four permanent categories,
 * so planeswalker coverage never appears independently of creature/artifact/
 * enchantment in any real fixture — weighting it fully would pay a modal card
 * four times. Land destruction is not required for a healthy interaction suite.
 *
 * `graveyard` is absent on purpose: targetCoverage.graveyard is structurally
 * always 0 (the coverage loop only visits cards with the `interaction` role,
 * and graveyard hate carries the `graveyard_hate` role instead). Graveyard
 * capability is owned by its own component.
 */
const COVERAGE_WEIGHTS: Partial<Record<InteractionTarget, number>> = {
  creature: 0.25,
  spell: 0.25,
  artifact: 0.2,
  enchantment: 0.2,
  land: 0.05,
  planeswalker: 0.05,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round2 = (n: number) => Math.round(n * 100) / 100;
/** Shared diminishing-returns curve, as used by Speed and Consistency. */
const sat = (value: number, scale: number) =>
  value <= 0 ? 0 : 1 - Math.exp(-value / scale);

export function ratingFor(score: number): InteractionRating {
  if (score < 25) return 'low';
  if (score < 45) return 'moderate';
  if (score < 65) return 'good';
  if (score < 80) return 'high';
  return 'elite';
}

// ---------------------------------------------------------------------------
// Physical-card bucketing
// ---------------------------------------------------------------------------

interface Slot {
  card: ResolvedCard;
  quantity: number;
  roles: Set<CardRole>;
  free: boolean;
  efficient: boolean;
}

/**
 * Walk the deck once, resolving each physical card's roles and power
 * properties. Commanders are included: a commander that interacts is
 * genuinely available, and Phase 4A already counts commander slots this way.
 */
function slotsOf(composition: DeckComposition): Slot[] {
  const build = (card: ResolvedCard, quantity: number): Slot => {
    const powers = new Set(analyzeCardPower(card).assignments.map((a) => a.property));
    return {
      card,
      quantity,
      roles: new Set(classifyCardRoles(card).assignments.map((a) => a.role)),
      free: powers.has('free_interaction'),
      efficient: powers.has('efficient_interaction'),
    };
  };
  return [
    ...composition.commanders.map((c) => build(c, 1)),
    ...composition.mainboard.map((m) => build(m.card, m.quantity)),
  ];
}

const total = (slots: Slot[], pred: (s: Slot) => boolean) =>
  slots.reduce((n, s) => (pred(s) ? n + s.quantity : n), 0);

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/**
 * Physical availability.
 *
 * Built from DISJOINT buckets rather than from interactionCount plus its
 * components: Phase 4A's `boardWipeCount` counts wipes whether or not they
 * also carry the interaction role, and `targetedInteractionCount` excludes
 * them, so those fields overlap and their sum overshoots `interactionCount`
 * on 8 of 9 real decks. Bucketing per physical card is the only safe route.
 */
function scoreAvailability(slots: Slot[], deckSize: number): InteractionComponent {
  const targetedNonWipe = total(
    slots,
    (s) => s.roles.has('interaction') && !s.roles.has('board_wipe'),
  );
  const wipe = total(slots, (s) => s.roles.has('board_wipe'));
  const gyHateOnly = total(
    slots,
    (s) =>
      s.roles.has('graveyard_hate') && !s.roles.has('interaction') && !s.roles.has('board_wipe'),
  );

  const pool = WEIGHT_TARGETED * targetedNonWipe + WEIGHT_WIPE * wipe + WEIGHT_GY_HATE_ONLY * gyHateOnly;
  const normalized = pool * (REFERENCE_DECK_SIZE / Math.max(1, deckSize));

  return {
    score: AVAILABILITY_MAX * sat(normalized, 7),
    max: AVAILABILITY_MAX,
    raw: {
      targetedNonWipe,
      wipe,
      gyHateOnly,
      physicalCards: targetedNonWipe + wipe + gyHateOnly,
      weightedPool: round2(pool),
      deckSize,
      normalizedDensity: round2(normalized),
    },
  };
}

/**
 * Efficiency. One physical card enters exactly one bucket, at its strongest:
 * Force of Will is free only, Swords to Plowshares efficient, Beast Within
 * generic.
 */
function scoreEfficiency(slots: Slot[]): InteractionComponent {
  const interacts = (s: Slot) =>
    s.roles.has('interaction') || s.roles.has('board_wipe') || s.roles.has('graveyard_hate');

  /** 1.00 for ordinary interaction; reduced when only a specialist admits it. */
  const specialistWeight = (s: Slot): number => {
    if (s.roles.has('interaction')) return 1;
    if (s.roles.has('board_wipe')) return SPECIALIST_EFFICIENCY_WEIGHT_WIPE;
    if (s.roles.has('graveyard_hate')) return SPECIALIST_EFFICIENCY_WEIGHT_GY_HATE;
    return 0;
  };

  const weighted = (pred: (s: Slot) => boolean) =>
    slots.reduce((n, s) => (pred(s) ? n + s.quantity * specialistWeight(s) : n), 0);

  // Head-count buckets stay unweighted so the diagnostics remain readable.
  const free = total(slots, (s) => s.free);
  const efficient = total(slots, (s) => s.efficient && !s.free);
  const generic = total(slots, (s) => interacts(s) && !s.efficient && !s.free);

  // Cost-tier semantics are unchanged; only each card's share is weighted.
  const pool =
    WEIGHT_FREE * weighted((s) => s.free) +
    WEIGHT_EFFICIENT * weighted((s) => s.efficient && !s.free) +
    WEIGHT_GENERIC * weighted((s) => interacts(s) && !s.efficient && !s.free);

  const specialistOnly = total(
    slots,
    (s) => interacts(s) && !s.roles.has('interaction'),
  );

  return {
    score: EFFICIENCY_MAX * sat(pool, 8),
    max: EFFICIENCY_MAX,
    raw: {
      free,
      efficientNonFree: efficient,
      generic,
      specialistOnly,
      weightedPool: round2(pool),
    },
  };
}

/**
 * Capability coverage: which threat classes can the deck answer at all.
 *
 * Presence-based, not count-based, so twelve creature-removal spells earn the
 * creature category exactly once. This is what makes a broad eight-card suite
 * able to out-cover a narrow twelve-card one.
 */
function scoreCoverage(targetCoverage: Record<InteractionTarget, number>): CoverageComponent {
  const categories: CoverageDetail[] = (
    Object.keys(COVERAGE_WEIGHTS) as InteractionTarget[]
  ).map((category) => ({
    category,
    covered: (targetCoverage[category] ?? 0) > 0,
    support: targetCoverage[category] ?? 0,
    weight: COVERAGE_WEIGHTS[category] ?? 0,
  }));

  const breadth = categories.reduce((sum, c) => (c.covered ? sum + c.weight : sum), 0);
  return {
    score: COVERAGE_MAX * breadth,
    max: COVERAGE_MAX,
    categories,
    raw: {
      breadth: round2(breadth),
      coveredCategories: categories.filter((c) => c.covered).length,
      totalCategories: categories.length,
    },
  };
}

/**
 * Stack capability.
 *
 * Capability-first: the presence term makes the FIRST counterspell worth
 * disproportionately more than the second, because being able to answer on the
 * stack at all is the strategic step change. A deck with none loses this
 * component but can still score well elsewhere — stack access is a strength,
 * not a universal requirement.
 */
function scoreStack(evidence: DeckPowerEvidence): InteractionComponent {
  const i = evidence.interaction;
  const freeCounter = i.freeCounterspellCount;
  const efficientCounter = Math.max(0, i.efficientCounterspellCount - freeCounter);
  const genericCounter = Math.max(0, i.counterspellCount - i.efficientCounterspellCount);

  const pool =
    WEIGHT_FREE_COUNTER * freeCounter +
    WEIGHT_EFFICIENT_COUNTER * efficientCounter +
    WEIGHT_GENERIC_COUNTER * genericCounter;

  const depth = 11 * sat(pool, 5);
  const presence = i.counterspellCount > 0 ? 4 : 0;

  return {
    score: presence + depth,
    max: STACK_MAX,
    raw: {
      counterspells: i.counterspellCount,
      freeCounterspells: freeCounter,
      efficientNonFreeCounterspells: efficientCounter,
      genericCounterspells: genericCounter,
      weightedPool: round2(pool),
      presence,
      depth: round2(depth),
    },
  };
}

/**
 * Persistent disruption.
 *
 * Kept modest and breadth-led. Phase 4A does not model asymmetry, so a
 * symmetric prison piece and a one-sided one score identically; more stax is
 * therefore not reliably better, and density is capped at 4 of 10.
 */
function scoreStax(evidence: DeckPowerEvidence): InteractionComponent {
  const coverage = evidence.stax.restrictionCoverage;
  const allCategories = Object.keys(coverage).length;
  const activeCategories = Object.values(coverage).filter((n) => n > 0).length;

  const breadth = allCategories === 0 ? 0 : 6 * (activeCategories / allCategories);
  const density = 4 * sat(evidence.stax.staxCount, 3);

  return {
    score: breadth + density,
    max: STAX_MAX,
    raw: {
      staxCount: evidence.stax.staxCount,
      activeRestrictionCategories: activeCategories,
      totalRestrictionCategories: allCategories,
      breadth: round2(breadth),
      density: round2(density),
    },
  };
}

/**
 * Graveyard capability.
 *
 * Small and fast-saturating: graveyard interaction is important but
 * specialised, and it already earns secondary credit through availability and,
 * for persistent locks, through stax. Uses graveyardHateCount rather than
 * targetCoverage.graveyard, which is structurally always zero.
 */
function scoreGraveyard(evidence: DeckPowerEvidence): InteractionComponent {
  const count = evidence.interaction.graveyardHateCount;
  return {
    score: GRAVEYARD_MAX * sat(count, 2.5),
    max: GRAVEYARD_MAX,
    raw: { graveyardHateCount: count },
  };
}

/**
 * Board reset. Strong diminishing returns: a small number of wipes carries
 * almost all the signal, and eight must not read as twice as good as four.
 * Capped at 5 so wipes can never substitute for targeted or stack interaction.
 */
function scoreBoardReset(evidence: DeckPowerEvidence): InteractionComponent {
  const count = evidence.interaction.boardWipeCount;
  return {
    score: BOARD_RESET_MAX * sat(count, 1.6),
    max: BOARD_RESET_MAX,
    raw: { boardWipeCount: count },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function collectLimitations(evidence: DeckPowerEvidence, slots: Slot[]): string[] {
  const limitations: string[] = [];
  const i = evidence.interaction;

  if (evidence.stax.staxCount > 0) {
    limitations.push(
      'stax asymmetry is not modelled: a symmetric prison piece and a one-sided ' +
        'one score identically, so stax credit is deliberately capped',
    );
  }

  const modal = slots.filter(
    (s) => s.roles.has('interaction') && /\btarget (?:nonland )?permanent\b/i.test(s.card.oracleText),
  );
  if (modal.length > 0) {
    limitations.push(
      `${modal.length} modal permanent answer(s) expand to four coverage categories each ` +
        '(Phase 4A behaviour); coverage overstates flexible cards, while availability counts them once',
    );
  }

  if (i.graveyardHateCount > 0) {
    limitations.push(
      'graveyard coverage is derived from graveyardHateCount: Phase 4A targetCoverage.graveyard ' +
        'is structurally always zero',
    );
  }

  if (i.counterspellCount > 0) {
    limitations.push(
      'counterspells intentionally earn credit in both efficiency and stack capability; ' +
        'these components answer different questions and are not deduplicated',
    );
  }

  /*
   * Always disclosed: properties of the model itself rather than of any
   * particular deck, so they must not be conditional on the evidence.
   */
  limitations.push(
    'Phase 4A exposes no instant-speed flag, so timing is not distinguished ' +
      'within targeted interaction',
  );
  limitations.push('commander-supplied interaction is not measured; no evidence seam exists');
  limitations.push(
    'stack capability is deliberately capability-first: the first counterspell is worth ' +
      'far more than the second, a known 0-to-1 discontinuity',
  );
  limitations.push(
    'coverage is presence-oriented, so it behaves as a capability checklist rather than ' +
      'a discriminating measure once a deck holds one broad answer',
  );

  return limitations;
}

/**
 * Score the INTERACTION dimension.
 *
 * Components sum to 100: availability 25, efficiency 25, coverage 15,
 * stack 15, stax 10, graveyard 5, board reset 5.
 *
 * Coverage carries 15 rather than 20 because Phase 4A expands modal permanent
 * answers into four categories, making coverage partly a restatement of
 * density; the 5 points fund the standalone graveyard component.
 */
export function scoreInteraction(
  composition: DeckComposition,
  evidence: DeckPowerEvidence,
): InteractionDimension {
  const slots = slotsOf(composition);
  const deckSize = slots.reduce((n, s) => n + s.quantity, 0);

  const availability = scoreAvailability(slots, deckSize);
  const efficiency = scoreEfficiency(slots);
  const coverage = scoreCoverage(evidence.interaction.targetCoverage);
  const stack = scoreStack(evidence);
  const stax = scoreStax(evidence);
  const graveyard = scoreGraveyard(evidence);
  const boardReset = scoreBoardReset(evidence);

  const score = clamp(
    availability.score +
      efficiency.score +
      coverage.score +
      stack.score +
      stax.score +
      graveyard.score +
      boardReset.score,
    0,
    100,
  );

  const r = (c: InteractionComponent) => ({ ...c, score: round2(c.score) });
  return {
    score: round2(score),
    rating: ratingFor(score),
    availability: r(availability),
    efficiency: r(efficiency),
    coverage: { ...coverage, score: round2(coverage.score) },
    stack: r(stack),
    stax: r(stax),
    graveyard: r(graveyard),
    boardReset: r(boardReset),
    limitations: collectLimitations(evidence, slots),
  };
}
