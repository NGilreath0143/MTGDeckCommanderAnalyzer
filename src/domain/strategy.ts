import { cardTypes } from './cardFacts';
import { classifyCardRoles } from './roles';
import { classifyCardTags } from './tags';
import {
  STRATEGY_SIGNAL_TYPES,
  type CardTag,
  type DeckComposition,
  type DeckStrategyProfile,
  type ResolvedCard,
  type StrategyCapDiagnostic,
  type StrategyCoverage,
  type StrategyRelationshipResult,
  type StrategySignal,
  type StrategySignalType,
  type StrategyStrength,
  type StrategyStructure,
} from './types';

/**
 * Deterministic deck-level strategy signals. Pure: no I/O, no LLM.
 *
 * Answers "which broad strategic families are present, and how strongly" from
 * the Phase 3A tags and Phase 2 roles already computed per card. It does NOT
 * infer named archetypes — that is a later phase.
 *
 * Every score is built from four visible components so any number can be
 * explained: coverage (0-40), structure (0-30), diversity (0-15), commander
 * alignment (0-15). Component values are kept unrounded internally and rounded
 * only at the edge for reporting.
 */

// ---------------------------------------------------------------------------
// Scoring primitives
// ---------------------------------------------------------------------------

const COVERAGE_MAX = 40;
const COVERAGE_SCALE = 12;
const RELATIONSHIP_SCALE = 4;
const DIVERSITY_MAX = 15;
const DEFAULT_SINGLE_TAG_CAP = 30;
/** Supporting cards needed for a tag to count as fully represented. */
const DIVERSITY_SUPPORT_FULL = 2;

/** Minimum distinct contributing cards before a relationship scores at all. */
const MIN_DISTINCT_CARDS_FOR_RELATIONSHIP = 2;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Diminishing returns on the number of participating cards. */
export function coverageScoreFor(participatingCards: number): number {
  return clamp(
    COVERAGE_MAX * (1 - Math.exp(-participatingCards / COVERAGE_SCALE)),
    0,
    COVERAGE_MAX,
  );
}

/** Diminishing returns on how much mutual support a relationship has. */
export function relationshipScoreFor(support: number, maxScore: number): number {
  if (support <= 0) return 0;
  return clamp(maxScore * (1 - Math.exp(-support / RELATIONSHIP_SCALE)), 0, maxScore);
}

export function strengthFor(score: number): StrategyStrength {
  if (score < 15) return 'negligible';
  if (score < 30) return 'minor';
  if (score < 50) return 'supporting';
  if (score < 70) return 'strong';
  return 'defining';
}

/** Two decimals; presentation only. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Per-card evidence, gathered once
// ---------------------------------------------------------------------------

/**
 * One card slot's contribution, with quantity attached.
 *
 * Commanders are included here with quantity 1 but flagged, because they count
 * toward structure/diversity/alignment and never toward coverage.
 */
interface CardEvidence {
  card: ResolvedCard;
  quantity: number;
  isCommander: boolean;
  tags: Set<CardTag>;
  isPlaneswalker: boolean;
  isRamp: boolean;
}

function gatherEvidence(composition: DeckComposition): CardEvidence[] {
  const evidence: CardEvidence[] = [];

  const add = (card: ResolvedCard, quantity: number, isCommander: boolean) => {
    evidence.push({
      card,
      quantity,
      isCommander,
      tags: new Set(classifyCardTags(card).assignments.map((a) => a.tag)),
      isPlaneswalker: cardTypes(card.typeLine).includes('Planeswalker'),
      isRamp: classifyCardRoles(card).assignments.some((a) => a.role === 'ramp'),
    });
  };

  for (const card of composition.commanders) add(card, 1, true);
  for (const { card, quantity } of composition.mainboard) add(card, quantity, false);
  return evidence;
}

// ---------------------------------------------------------------------------
// Relationship sides
// ---------------------------------------------------------------------------

/**
 * One side of a relationship. Usually a set of tags, but two approved
 * non-tag sides exist: actual planeswalker cards, and high Phase 2 ramp.
 */
type SideKind = 'tags' | 'planeswalker-cards';

interface RelationshipSide {
  kind: SideKind;
  tags?: CardTag[];
}

const tagSide = (...tags: CardTag[]): RelationshipSide => ({ kind: 'tags', tags });
const planeswalkerCardSide = (): RelationshipSide => ({ kind: 'planeswalker-cards' });

function matchesSide(e: CardEvidence, side: RelationshipSide): boolean {
  if (side.kind === 'planeswalker-cards') return e.isPlaneswalker;
  return (side.tags ?? []).some((t) => e.tags.has(t));
}

interface RelationshipDefinition {
  id: string;
  a: RelationshipSide;
  b: RelationshipSide;
  maxScore: number;
}

/**
 * Score one relationship.
 *
 * Support is quantity-weighted, then adjusted so a single card carrying BOTH
 * sides cannot form an engine by itself: dual-purpose cards only contribute
 * once another distinct card supplies a side. Commanders are subject to the
 * same rule.
 */
function scoreRelationship(
  definition: RelationshipDefinition,
  evidence: CardEvidence[],
): StrategyRelationshipResult {
  let onlyA = 0;
  let onlyB = 0;
  let both = 0;
  let distinctContributors = 0;

  for (const e of evidence) {
    const hasA = matchesSide(e, definition.a);
    const hasB = matchesSide(e, definition.b);
    if (!hasA && !hasB) continue;
    distinctContributors += 1;
    if (hasA && hasB) both += e.quantity;
    else if (hasA) onlyA += e.quantity;
    else onlyB += e.quantity;
  }

  const countA = onlyA + both;
  const countB = onlyB + both;
  const rawSupport = Math.min(countA, countB);

  /*
   * Pair one-sided cards first, then let dual cards fill in only as far as the
   * one-sided cards can partner them. A lone dual card therefore yields 0.
   */
  const pairedOneSided = Math.min(onlyA, onlyB);
  const dualContribution = Math.min(both, Math.max(onlyA, onlyB));
  let distinctSupport = pairedOneSided + dualContribution;

  // An engine needs at least two distinct cards, however the quantities fall.
  if (distinctContributors < MIN_DISTINCT_CARDS_FOR_RELATIONSHIP) distinctSupport = 0;

  return {
    id: definition.id,
    rawSupport,
    distinctSupport,
    score: relationshipScoreFor(distinctSupport, definition.maxScore),
    maxScore: definition.maxScore,
  };
}

// ---------------------------------------------------------------------------
// Family definitions
// ---------------------------------------------------------------------------

interface FamilyDefinition {
  strategy: StrategySignalType;
  tags: CardTag[];
  relationships: RelationshipDefinition[];
  /** Planeswalkers only: actual planeswalker cards count as coverage. */
  planeswalkerTypeEvidence?: boolean;
  /** Lands only: high Phase 2 ramp is supporting structural evidence. */
  rampSupport?: { id: string; maxScore: number };
  /** Single represented tag -> this maximum, overriding the default 30. */
  singleTagCaps?: Partial<Record<CardTag, number | null>>;
}

const FAMILIES: FamilyDefinition[] = [
  {
    strategy: 'counters',
    tags: [
      'counter_generation',
      'counter_payoff',
      'counter_doubling',
      'proliferate',
      'plus_one_counters',
    ],
    relationships: [
      {
        id: 'counter_generation+counter_payoff',
        a: tagSide('counter_generation'),
        b: tagSide('counter_payoff'),
        maxScore: 10,
      },
      {
        id: 'counter_generation+counter_doubling',
        a: tagSide('counter_generation'),
        b: tagSide('counter_doubling'),
        maxScore: 6,
      },
      {
        id: 'counter_generation+proliferate',
        a: tagSide('counter_generation'),
        b: tagSide('proliferate'),
        maxScore: 5,
      },
      {
        id: 'counter_payoff+proliferate',
        a: tagSide('counter_payoff'),
        b: tagSide('proliferate'),
        maxScore: 5,
      },
      {
        // plus_one_counters against whichever of generation/payoff is stronger.
        id: 'plus_one_counters+generation_or_payoff',
        a: tagSide('plus_one_counters'),
        b: tagSide('counter_generation', 'counter_payoff'),
        maxScore: 4,
      },
    ],
  },
  {
    strategy: 'tokens',
    tags: ['token_generation', 'token_payoff', 'token_doubling'],
    relationships: [
      {
        id: 'token_generation+token_payoff',
        a: tagSide('token_generation'),
        b: tagSide('token_payoff'),
        maxScore: 18,
      },
      {
        id: 'token_generation+token_doubling',
        a: tagSide('token_generation'),
        b: tagSide('token_doubling'),
        maxScore: 8,
      },
      {
        id: 'token_payoff+token_doubling',
        a: tagSide('token_payoff'),
        b: tagSide('token_doubling'),
        maxScore: 4,
      },
    ],
  },
  {
    strategy: 'sacrifice',
    tags: ['sacrifice_outlet', 'sacrifice_fodder', 'sacrifice_payoff', 'death_payoff'],
    relationships: [
      {
        id: 'sacrifice_fodder+sacrifice_outlet',
        a: tagSide('sacrifice_fodder'),
        b: tagSide('sacrifice_outlet'),
        maxScore: 8,
      },
      {
        id: 'sacrifice_outlet+death_payoff',
        a: tagSide('sacrifice_outlet'),
        b: tagSide('death_payoff'),
        maxScore: 7,
      },
      {
        id: 'sacrifice_outlet+sacrifice_payoff',
        a: tagSide('sacrifice_outlet'),
        b: tagSide('sacrifice_payoff'),
        maxScore: 7,
      },
      {
        id: 'sacrifice_fodder+death_payoff',
        a: tagSide('sacrifice_fodder'),
        b: tagSide('death_payoff'),
        maxScore: 4,
      },
      {
        id: 'sacrifice_fodder+sacrifice_payoff',
        a: tagSide('sacrifice_fodder'),
        b: tagSide('sacrifice_payoff'),
        maxScore: 4,
      },
    ],
  },
  {
    strategy: 'graveyard',
    tags: ['graveyard_filling', 'self_mill', 'graveyard_payoff', 'reanimation'],
    relationships: [
      {
        id: 'graveyard_filling+reanimation',
        a: tagSide('graveyard_filling'),
        b: tagSide('reanimation'),
        maxScore: 9,
      },
      {
        id: 'self_mill+reanimation',
        a: tagSide('self_mill'),
        b: tagSide('reanimation'),
        maxScore: 7,
      },
      {
        id: 'self_mill+graveyard_payoff',
        a: tagSide('self_mill'),
        b: tagSide('graveyard_payoff'),
        maxScore: 5,
      },
      {
        id: 'graveyard_filling+graveyard_payoff',
        a: tagSide('graveyard_filling'),
        b: tagSide('graveyard_payoff'),
        maxScore: 5,
      },
      {
        id: 'reanimation+graveyard_payoff',
        a: tagSide('reanimation'),
        b: tagSide('graveyard_payoff'),
        maxScore: 4,
      },
    ],
    singleTagCaps: { reanimation: 49 },
  },
  {
    strategy: 'artifacts',
    tags: [
      'artifact_generation',
      'artifact_payoff',
      'artifact_cost_reduction',
      'artifact_sacrifice',
    ],
    relationships: [
      {
        id: 'artifact_generation+artifact_payoff',
        a: tagSide('artifact_generation'),
        b: tagSide('artifact_payoff'),
        maxScore: 12,
      },
      {
        id: 'artifact_payoff+artifact_cost_reduction',
        a: tagSide('artifact_payoff'),
        b: tagSide('artifact_cost_reduction'),
        maxScore: 7,
      },
      {
        id: 'artifact_generation+artifact_sacrifice',
        a: tagSide('artifact_generation'),
        b: tagSide('artifact_sacrifice'),
        maxScore: 6,
      },
      {
        id: 'artifact_payoff+artifact_sacrifice',
        a: tagSide('artifact_payoff'),
        b: tagSide('artifact_sacrifice'),
        maxScore: 5,
      },
    ],
  },
  {
    strategy: 'enchantments',
    tags: [
      'enchantment_generation',
      'enchantment_payoff',
      'enchantment_cost_reduction',
      'aura',
    ],
    relationships: [
      {
        id: 'enchantment_generation+enchantment_payoff',
        a: tagSide('enchantment_generation'),
        b: tagSide('enchantment_payoff'),
        maxScore: 10,
      },
      {
        id: 'enchantment_payoff+enchantment_cost_reduction',
        a: tagSide('enchantment_payoff'),
        b: tagSide('enchantment_cost_reduction'),
        maxScore: 8,
      },
      {
        id: 'aura+enchantment_payoff',
        a: tagSide('aura'),
        b: tagSide('enchantment_payoff'),
        maxScore: 7,
      },
      {
        id: 'aura+enchantment_generation',
        a: tagSide('aura'),
        b: tagSide('enchantment_generation'),
        maxScore: 5,
      },
    ],
  },
  {
    strategy: 'spells',
    tags: ['spell_payoff', 'spell_copy', 'spell_cost_reduction', 'spell_recursion'],
    relationships: [
      {
        id: 'spell_payoff+spell_cost_reduction',
        a: tagSide('spell_payoff'),
        b: tagSide('spell_cost_reduction'),
        maxScore: 9,
      },
      {
        id: 'spell_payoff+spell_copy',
        a: tagSide('spell_payoff'),
        b: tagSide('spell_copy'),
        maxScore: 8,
      },
      {
        id: 'spell_payoff+spell_recursion',
        a: tagSide('spell_payoff'),
        b: tagSide('spell_recursion'),
        maxScore: 8,
      },
      {
        id: 'spell_copy+spell_recursion',
        a: tagSide('spell_copy'),
        b: tagSide('spell_recursion'),
        maxScore: 5,
      },
    ],
    singleTagCaps: { spell_payoff: 49 },
  },
  {
    strategy: 'lands',
    tags: ['landfall', 'land_payoff', 'land_recursion'],
    relationships: [
      {
        id: 'landfall+land_payoff',
        a: tagSide('landfall'),
        b: tagSide('land_payoff'),
        maxScore: 12,
      },
      {
        id: 'landfall+land_recursion',
        a: tagSide('landfall'),
        b: tagSide('land_recursion'),
        maxScore: 8,
      },
      {
        id: 'land_payoff+land_recursion',
        a: tagSide('land_payoff'),
        b: tagSide('land_recursion'),
        maxScore: 6,
      },
    ],
    rampSupport: { id: 'land_tag+high_ramp', maxScore: 4 },
    // A landfall-only deck is a coherent strategy, so it is not capped.
    singleTagCaps: { landfall: null },
  },
  {
    strategy: 'combat',
    tags: [
      'attack_payoff',
      'combat_damage_payoff',
      'extra_combat',
      'voltron',
      'go_wide_payoff',
    ],
    relationships: [
      {
        id: 'attack_payoff+extra_combat',
        a: tagSide('attack_payoff'),
        b: tagSide('extra_combat'),
        maxScore: 7,
      },
      {
        id: 'attack_payoff+combat_damage_payoff',
        a: tagSide('attack_payoff'),
        b: tagSide('combat_damage_payoff'),
        maxScore: 6,
      },
      {
        id: 'combat_damage_payoff+extra_combat',
        a: tagSide('combat_damage_payoff'),
        b: tagSide('extra_combat'),
        maxScore: 5,
      },
      {
        id: 'voltron+combat_damage_payoff',
        a: tagSide('voltron'),
        b: tagSide('combat_damage_payoff'),
        maxScore: 5,
      },
      {
        id: 'attack_payoff+go_wide_payoff',
        a: tagSide('attack_payoff'),
        b: tagSide('go_wide_payoff'),
        maxScore: 4,
      },
      {
        // Approved cross-family link: go-wide needs bodies to go wide with.
        id: 'go_wide_payoff+token_generation',
        a: tagSide('go_wide_payoff'),
        b: tagSide('token_generation'),
        maxScore: 3,
      },
    ],
    singleTagCaps: { voltron: 69, extra_combat: 69 },
  },
  {
    strategy: 'planeswalkers',
    tags: ['planeswalker_payoff', 'planeswalker_generation', 'planeswalker_doubling'],
    planeswalkerTypeEvidence: true,
    relationships: [
      {
        id: 'planeswalker_cards+planeswalker_payoff',
        a: planeswalkerCardSide(),
        b: tagSide('planeswalker_payoff'),
        maxScore: 12,
      },
      {
        id: 'planeswalker_cards+planeswalker_generation',
        a: planeswalkerCardSide(),
        b: tagSide('planeswalker_generation'),
        maxScore: 7,
      },
      {
        id: 'planeswalker_cards+planeswalker_doubling',
        a: planeswalkerCardSide(),
        b: tagSide('planeswalker_doubling'),
        maxScore: 5,
      },
      {
        id: 'planeswalker_payoff+planeswalker_generation',
        a: tagSide('planeswalker_payoff'),
        b: tagSide('planeswalker_generation'),
        maxScore: 3,
      },
      {
        id: 'planeswalker_payoff+planeswalker_doubling',
        a: tagSide('planeswalker_payoff'),
        b: tagSide('planeswalker_doubling'),
        maxScore: 3,
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Component scoring
// ---------------------------------------------------------------------------

function computeCoverage(
  family: FamilyDefinition,
  evidence: CardEvidence[],
): StrategyCoverage {
  const mainboard = evidence.filter((e) => !e.isCommander);
  const mainboardSize = mainboard.reduce((sum, e) => sum + e.quantity, 0);

  let taggedCards = 0;
  let additionalEvidenceCards = 0;
  let participatingCards = 0;

  for (const e of mainboard) {
    const tagged = family.tags.some((t) => e.tags.has(t));
    const typeEvidence = family.planeswalkerTypeEvidence === true && e.isPlaneswalker;
    if (tagged) taggedCards += e.quantity;
    if (typeEvidence) additionalEvidenceCards += e.quantity;
    // Deduplicated: a tagged planeswalker counts once.
    if (tagged || typeEvidence) participatingCards += e.quantity;
  }

  return {
    taggedCards,
    additionalEvidenceCards,
    participatingCards,
    mainboardSize,
    density: mainboardSize === 0 ? 0 : participatingCards / mainboardSize,
    score: coverageScoreFor(participatingCards),
  };
}

/** Quantity-weighted ramp pieces in the mainboard. */
function rampCount(evidence: CardEvidence[]): number {
  return evidence
    .filter((e) => !e.isCommander && e.isRamp)
    .reduce((sum, e) => sum + e.quantity, 0);
}

/**
 * Lands may consume high Phase 2 ramp as supporting evidence, but only when the
 * deck actually shows a Lands tag. Ordinary green ramp density must never
 * manufacture a Lands signal on its own.
 */
function scoreRampSupport(
  family: FamilyDefinition,
  evidence: CardEvidence[],
  representedTags: Set<CardTag>,
): StrategyRelationshipResult | null {
  const support = family.rampSupport;
  if (!support) return null;

  const hasLandTag = family.tags.some((t) => representedTags.has(t));
  const ramp = rampCount(evidence);
  // Linear: begins at 12 pieces, saturates at 20.
  const fraction = hasLandTag ? clamp((ramp - 12) / 8, 0, 1) : 0;

  return {
    id: support.id,
    rawSupport: ramp,
    distinctSupport: hasLandTag ? ramp : 0,
    score: fraction * support.maxScore,
    maxScore: support.maxScore,
  };
}

function computeStructure(
  family: FamilyDefinition,
  evidence: CardEvidence[],
  representedTags: Set<CardTag>,
): StrategyStructure {
  const relationships = family.relationships.map((r) => scoreRelationship(r, evidence));

  const ramp = scoreRampSupport(family, evidence, representedTags);
  if (ramp) relationships.push(ramp);

  return {
    score: relationships.reduce((sum, r) => sum + r.score, 0),
    relationships,
  };
}

/** Family tags present anywhere in the deck, commanders included. */
function representedFamilyTags(
  family: FamilyDefinition,
  evidence: CardEvidence[],
): Set<CardTag> {
  const present = new Set<CardTag>();
  for (const e of evidence) {
    for (const t of family.tags) if (e.tags.has(t)) present.add(t);
  }
  return present;
}

/**
 * Quantity-aware support per family tag across the whole deck, commanders
 * included. A commander carrying a tag contributes one support occurrence.
 */
function familyTagSupport(
  family: FamilyDefinition,
  evidence: CardEvidence[],
): Map<CardTag, number> {
  const support = new Map<CardTag, number>();
  for (const tag of family.tags) support.set(tag, 0);
  for (const e of evidence) {
    for (const tag of family.tags) {
      if (e.tags.has(tag)) support.set(tag, (support.get(tag) ?? 0) + e.quantity);
    }
  }
  return support;
}

/**
 * Diversity is support-weighted, not binary: one incidental copy of a tag is
 * half-represented, so a family cannot reach full diversity from a single
 * example of each of its tags.
 *
 *   0 supporting cards -> 0.0    1 -> 0.5    2+ -> 1.0
 */
function computeDiversity(
  family: FamilyDefinition,
  support: Map<CardTag, number>,
): number {
  if (family.tags.length === 0) return 0;
  const represented = family.tags.reduce(
    (sum, tag) => sum + Math.min((support.get(tag) ?? 0) / DIVERSITY_SUPPORT_FULL, 1),
    0,
  );
  return (represented / family.tags.length) * DIVERSITY_MAX;
}

/**
 * Commander alignment: distinct relevant tags across ALL commanders
 * collectively. Two commanders do not double the bonus.
 */
function commanderFamilyTags(
  family: FamilyDefinition,
  evidence: CardEvidence[],
): CardTag[] {
  const present = new Set<CardTag>();
  for (const e of evidence) {
    if (!e.isCommander) continue;
    for (const t of family.tags) if (e.tags.has(t)) present.add(t);
  }
  return family.tags.filter((t) => present.has(t));
}

export function commanderScoreFor(distinctCommanderTags: number): number {
  if (distinctCommanderTags <= 0) return 0;
  if (distinctCommanderTags === 1) return 8;
  return 15;
}

/**
 * A family represented by exactly one tag is usually incidental rather than a
 * strategy, so its final score is capped. Some single tags describe a coherent
 * plan on their own and have approved higher (or absent) caps.
 */
function computeCap(
  family: FamilyDefinition,
  represented: Set<CardTag>,
  rawScore: number,
): { score: number; cap: StrategyCapDiagnostic } {
  if (represented.size !== 1) {
    return { score: rawScore, cap: { applied: false } };
  }

  const [only] = [...represented];
  const override = family.singleTagCaps?.[only as CardTag];

  // null means explicitly uncapped (e.g. landfall-only).
  if (override === null) return { score: rawScore, cap: { applied: false } };

  const maximum = override ?? DEFAULT_SINGLE_TAG_CAP;
  if (rawScore <= maximum) {
    return { score: rawScore, cap: { applied: false, reason: 'single_tag', maximum } };
  }
  return { score: maximum, cap: { applied: true, reason: 'single_tag', maximum } };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Score every strategy family for a deck.
 *
 * Commanders are excluded from coverage (alignment covers them separately) but
 * included in structure, diversity, and alignment: structure asks whether the
 * deck's pieces work together, and the command zone is part of the deck.
 */
export function analyzeDeckStrategy(composition: DeckComposition): DeckStrategyProfile {
  const evidence = gatherEvidence(composition);

  const byStrategy = new Map<StrategySignalType, StrategySignal>();

  for (const family of FAMILIES) {
    const represented = representedFamilyTags(family, evidence);
    const tagSupport = familyTagSupport(family, evidence);
    const coverage = computeCoverage(family, evidence);
    const structure = computeStructure(family, evidence, represented);
    const diversityScore = computeDiversity(family, tagSupport);
    const commanderTags = commanderFamilyTags(family, evidence);
    const commanderScore = commanderScoreFor(commanderTags.length);

    const rawScore =
      coverage.score + structure.score + diversityScore + commanderScore;
    const { score, cap } = computeCap(family, represented, rawScore);

    byStrategy.set(family.strategy, {
      strategy: family.strategy,
      score: round2(clamp(score, 0, 100)),
      rawScore: round2(rawScore),
      strength: strengthFor(clamp(score, 0, 100)),
      coverageScore: round2(coverage.score),
      structureScore: round2(structure.score),
      diversityScore: round2(diversityScore),
      commanderScore,
      coverage: {
        ...coverage,
        density: round2(coverage.density),
        score: round2(coverage.score),
      },
      structure: {
        score: round2(structure.score),
        relationships: structure.relationships.map((r) => ({
          ...r,
          score: round2(r.score),
        })),
      },
      representedTags: family.tags.filter((t) => represented.has(t)),
      commanderTags,
      cap,
    });
  }

  // Stable, declared order so output is comparable between runs.
  return {
    signals: STRATEGY_SIGNAL_TYPES.map((s) => byStrategy.get(s)).filter(
      (s): s is StrategySignal => s !== undefined,
    ),
  };
}
