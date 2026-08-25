/**
 * Domain types. This module is pure: it must never import Prisma, `fetch`,
 * or anything from Next. Everything downstream analyses `ResolvedCard`.
 */

export type ColorCode = 'W' | 'U' | 'B' | 'R' | 'G';
export const COLOR_CODES: readonly ColorCode[] = ['W', 'U', 'B', 'R', 'G'];

export type Legality = 'legal' | 'not_legal' | 'restricted' | 'banned';

export type CardType =
  | 'Creature'
  | 'Instant'
  | 'Sorcery'
  | 'Artifact'
  | 'Enchantment'
  | 'Planeswalker'
  | 'Battle'
  | 'Land'
  | 'Other';

/**
 * Deterministic functional roles a card can fill. A card may fill zero or more.
 *
 * Deliberately NOT a taxonomy of everything a card can do: theft effects
 * (Act of Treason) and hand disruption (Thoughtseize) have no role here, so a
 * discard-heavy or threaten-heavy deck will show low interaction counts. That
 * gap is known and accepted for this phase.
 */
export type CardRole =
  | 'ramp'
  | 'card_advantage'
  | 'card_selection'
  | 'tutor'
  | 'interaction'
  | 'board_wipe'
  | 'protection'
  | 'recursion'
  | 'graveyard_hate';

export const CARD_ROLES: readonly CardRole[] = [
  'ramp',
  'card_advantage',
  'card_selection',
  'tutor',
  'interaction',
  'board_wipe',
  'protection',
  'recursion',
  'graveyard_hate',
];

/** One positive match, naming the deterministic rule that fired. */
export interface CardRoleAssignment {
  role: CardRole;
  /** Stable kebab-case rule identifier, e.g. 'mana-ability', 'counter-spell'. */
  ruleId: string;
}

/** Zero or more role assignments for a single card. */
export interface CardRoleAnalysis {
  /** The card's scryfallId. */
  cardId: string;
  assignments: CardRoleAssignment[];
}

/**
 * Deck-level role aggregation.
 *
 * Roles are multi-valued, so `counts` totals are NOT expected to sum to the
 * deck size.
 */
export interface DeckRoleProfile {
  /** Quantity-weighted: 4 copies of a ramp card contribute 4. */
  counts: Record<CardRole, number>;
  /** Distinct card names, commanders first then mainboard order. */
  cardsByRole: Record<CardRole, string[]>;
}

/**
 * Strategy tags describing the mechanics and strategic capabilities a card
 * advances. Deliberately distinct from CardRole: a role says what a card DOES
 * functionally (ramp, removal), a tag says which strategy it PARTICIPATES in.
 *
 * Semantic rules these encode:
 *  - A card type alone never implies participation (Sol Ring is not an
 *    artifact-strategy card; Teferi is not a planeswalker-strategy card).
 *  - Mentioning or interacting with a mechanic is not enough; the card must
 *    advance the user's strategy involving it (Solemnity opposes counters).
 *  - A contextual tag requires strong strategic synergy, not mere
 *    compatibility with resources the strategy produces.
 */
export type CardTag =
  // Counters
  | 'counter_generation'
  | 'counter_payoff'
  | 'counter_doubling'
  | 'proliferate'
  | 'plus_one_counters'

  // Tokens
  | 'token_generation'
  | 'token_payoff'
  | 'token_doubling'

  // Sacrifice / Death
  | 'sacrifice_outlet'
  | 'sacrifice_fodder'
  | 'sacrifice_payoff'
  | 'death_payoff'

  // Graveyard
  | 'graveyard_filling'
  | 'self_mill'
  | 'graveyard_payoff'
  | 'reanimation'

  // Artifacts
  | 'artifact_generation'
  | 'artifact_payoff'
  | 'artifact_cost_reduction'
  | 'artifact_sacrifice'

  // Enchantments
  | 'enchantment_generation'
  | 'enchantment_payoff'
  | 'enchantment_cost_reduction'
  | 'aura'

  // Spells
  | 'spell_payoff'
  | 'spell_copy'
  | 'spell_cost_reduction'
  | 'spell_recursion'

  // Lands
  | 'landfall'
  | 'land_payoff'
  | 'land_recursion'

  // Combat
  | 'attack_payoff'
  | 'combat_damage_payoff'
  | 'extra_combat'
  | 'voltron'
  | 'go_wide_payoff'

  // Planeswalkers
  | 'planeswalker_payoff'
  | 'planeswalker_generation'
  | 'planeswalker_doubling';

export const CARD_TAGS: readonly CardTag[] = [
  'counter_generation',
  'counter_payoff',
  'counter_doubling',
  'proliferate',
  'plus_one_counters',
  'token_generation',
  'token_payoff',
  'token_doubling',
  'sacrifice_outlet',
  'sacrifice_fodder',
  'sacrifice_payoff',
  'death_payoff',
  'graveyard_filling',
  'self_mill',
  'graveyard_payoff',
  'reanimation',
  'artifact_generation',
  'artifact_payoff',
  'artifact_cost_reduction',
  'artifact_sacrifice',
  'enchantment_generation',
  'enchantment_payoff',
  'enchantment_cost_reduction',
  'aura',
  'spell_payoff',
  'spell_copy',
  'spell_cost_reduction',
  'spell_recursion',
  'landfall',
  'land_payoff',
  'land_recursion',
  'attack_payoff',
  'combat_damage_payoff',
  'extra_combat',
  'voltron',
  'go_wide_payoff',
  'planeswalker_payoff',
  'planeswalker_generation',
  'planeswalker_doubling',
];

/** One positive tag match, naming the deterministic rule that fired. */
export interface CardTagAssignment {
  tag: CardTag;
  /** Stable kebab-case rule identifier. */
  ruleId: string;
}

/** Zero or more tag assignments for a single card. */
export interface CardTagAnalysis {
  /** The card's scryfallId. */
  cardId: string;
  assignments: CardTagAssignment[];
}

/**
 * Deck-level tag aggregation. Tags are multi-valued, so totals are NOT
 * expected to sum to the deck size.
 */
export interface DeckTagProfile {
  /** Quantity-weighted: 4 copies of a landfall card contribute 4. */
  counts: Record<CardTag, number>;
  /** Distinct card names, commanders first then mainboard order. */
  cardsByTag: Record<CardTag, string[]>;
}

/**
 * The single internal card shape. Both cached rows and freshly fetched
 * Scryfall responses are mapped to this before any domain code sees them,
 * so cache-vs-network can never change analysis behaviour.
 */
export interface ResolvedCard {
  scryfallId: string;
  oracleId: string;
  /** Canonical Scryfall name, e.g. "Nazgûl", "Malakir Rebirth // Malakir Mire". */
  name: string;
  manaCost: string | null;
  /** Top-level Scryfall cmc. Authoritative, including for modal DFCs. */
  cmc: number;
  /** May contain " // " for multi-faced cards. */
  typeLine: string;
  colorIdentity: ColorCode[];
  colors: ColorCode[];
  layout: string;
  keywords: string[];
  /** "" when absent; faces joined with "\n//\n". */
  oracleText: string;
  commanderLegality: Legality;
  /**
   * Colors this card can produce, from Scryfall's `produced_mana`. Optional
   * because it comes from the retained raw payload; absent for hand-built
   * fixtures. Not oracle-text derivable (duals hide mana in reminder text).
   */
  producedMana?: ColorCode[];
}

export type DeckSection = 'main' | 'commander' | 'sideboard';

export interface ParsedLine {
  raw: string;
  lineNumber: number;
  quantity: number;
  /** Card name with set code and collector number stripped. */
  name: string;
  setCode: string | null;
  section: DeckSection;
}

export interface ParseError {
  lineNumber: number;
  raw: string;
  reason: string;
}

export interface ParsedDeck {
  entries: ParsedLine[];
  errors: ParseError[];
}

export type CommanderEligibility = 'legendary-creature' | 'can-be-your-commander';

export interface CommanderInfo {
  scryfallId: string;
  name: string;
  colorIdentity: ColorCode[];
  eligibility: CommanderEligibility;
  hasPartner: boolean;
  choosesBackground: boolean;
  isBackground: boolean;
}

export type ValidationCode =
  | 'DECK_SIZE'
  | 'SINGLETON'
  | 'COLOR_IDENTITY'
  | 'BANNED'
  | 'NOT_LEGAL'
  | 'NO_COMMANDER'
  | 'INVALID_COMMANDER'
  | 'TOO_MANY_COMMANDERS'
  | 'UNRESOLVED_CARDS';

export interface ValidationIssue {
  code: ValidationCode;
  severity: 'error' | 'warning';
  message: string;
  cardNames?: string[];
  details?: Record<string, unknown>;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export interface DeckStats {
  totalCards: number;
  landCount: number;
  nonlandCount: number;
  /**
   * Average mana value over nonland, non-commander cards, weighted by
   * quantity. Lands are excluded deliberately: including them drags every
   * Commander deck toward ~2.0, which is not what players mean by "average MV".
   */
  averageManaValue: number;
  /** Buckets "0".."6" plus "7+"; values are card counts. */
  manaCurve: Record<string, number>;
  /** Each card counted once via primaryCardType, so buckets sum to deck size. */
  typeDistribution: Record<CardType, number>;
  /** Mana-cost pip counts, with a colorless "C" bucket. */
  colorDistribution: Record<ColorCode | 'C', number>;
  /** Count of cards whose color identity includes each color. */
  colorIdentityDistribution: Record<ColorCode, number>;
}

export interface UnresolvedEntry {
  name: string;
  quantity: number;
  reason: string;
}

/** A deck as the pure analysis functions see it. */
export interface DeckComposition {
  commanders: ResolvedCard[];
  mainboard: { card: ResolvedCard; quantity: number }[];
}

/**
 * Broad strategic families a deck can pursue. Phase 3B scores how strongly each
 * is present; it deliberately does NOT infer named archetypes (Aristocrats,
 * Superfriends, Voltron), which is a later phase's job.
 */
export type StrategySignalType =
  | 'counters'
  | 'tokens'
  | 'sacrifice'
  | 'graveyard'
  | 'artifacts'
  | 'enchantments'
  | 'spells'
  | 'lands'
  | 'combat'
  | 'planeswalkers';

export const STRATEGY_SIGNAL_TYPES: readonly StrategySignalType[] = [
  'counters',
  'tokens',
  'sacrifice',
  'graveyard',
  'artifacts',
  'enchantments',
  'spells',
  'lands',
  'combat',
  'planeswalkers',
];

/**
 * Calibration bands for a final 0-100 score. These are calibration values,
 * not permanent truths.
 */
export type StrategyStrength =
  | 'negligible'
  | 'minor'
  | 'supporting'
  | 'strong'
  | 'defining';

export interface StrategyCoverage {
  /** Quantity-weighted mainboard cards carrying a family tag. */
  taggedCards: number;
  /** Quantity-weighted mainboard cards counted by approved type evidence. */
  additionalEvidenceCards: number;
  /** Deduplicated union of the two above. */
  participatingCards: number;
  /** Actual composition size, not an assumed 99. */
  mainboardSize: number;
  density: number;
  score: number;
}

export interface StrategyRelationshipResult {
  id: string;
  /** min(countA, countB), kept for diagnostics. */
  rawSupport: number;
  /**
   * Support after removing one-card self-synergy: a single card carrying both
   * sides cannot form an engine alone.
   */
  distinctSupport: number;
  score: number;
  maxScore: number;
}

export interface StrategyStructure {
  score: number;
  relationships: StrategyRelationshipResult[];
}

export interface StrategyCapDiagnostic {
  applied: boolean;
  reason?: string;
  maximum?: number;
}

export interface StrategySignal {
  strategy: StrategySignalType;
  /** Final score after any cap, 0-100. */
  score: number;
  /** Uncapped component total, preserved for diagnostics. */
  rawScore: number;
  strength: StrategyStrength;
  coverageScore: number;
  structureScore: number;
  diversityScore: number;
  commanderScore: number;
  coverage: StrategyCoverage;
  structure: StrategyStructure;
  /** Family tags present anywhere in the deck, commanders included. */
  representedTags: string[];
  /** Distinct family tags across all commanders collectively. */
  commanderTags: string[];
  cap: StrategyCapDiagnostic;
}

export interface DeckStrategyProfile {
  signals: StrategySignal[];
}

import type { DeckPowerEvidence } from './powerEvidence';

/** Archetypes are recognizable deck plans; themes are strategic motifs. */
export type InferenceKind = 'archetype' | 'theme';

export type ArchetypeInferenceType =
  | 'aristocrats'
  | 'reanimator'
  | 'superfriends'
  | 'spellslinger'
  | 'voltron'
  | 'aura_voltron'
  | 'enchantress'
  | 'counters'
  | 'proliferate'
  | 'tokens'
  | 'go_wide'
  | 'artifacts'
  | 'landfall'
  | 'lands';

export const ARCHETYPE_INFERENCE_TYPES: readonly ArchetypeInferenceType[] = [
  'aristocrats',
  'reanimator',
  'superfriends',
  'spellslinger',
  'voltron',
  'aura_voltron',
  'enchantress',
  'counters',
  'proliferate',
  'tokens',
  'go_wide',
  'artifacts',
  'landfall',
  'lands',
];

/** Initial calibration bands. Explicitly NOT final. */
export type InferenceConfidence = 'weak' | 'possible' | 'likely' | 'defining';

/** One piece of visible reasoning behind an inference. */
export interface ArchetypeEvidenceItem {
  id: string;
  description: string;
  value?: number | string | boolean;
  contribution?: number;
}

export interface ArchetypeInference {
  archetype: ArchetypeInferenceType;
  kind: InferenceKind;
  score: number;
  confidence: InferenceConfidence;
  /** Set when this inference specializes another (aura_voltron -> voltron). */
  parent?: ArchetypeInferenceType;
  /** False means the required anchor was absent; score is then 0. */
  anchorSatisfied: boolean;
  evidence: ArchetypeEvidenceItem[];
}

export interface DeckArchetypeProfile {
  inferences: ArchetypeInference[];
}

/**
 * The structured result of profiling a decklist.
 *
 * Later features attach as optional sibling keys, so nothing here changes:
 *   analysis?: LlmAnalysis
 */
export interface DeckProfile {
  deckId: string | null;
  name: string | null;
  commanders: CommanderInfo[];
  /** Includes commanders. */
  totalCards: number;
  validation: ValidationResult;
  stats: DeckStats;
  unresolved: UnresolvedEntry[];
  parseErrors: ParseError[];
  generatedAt: string;
  /** Deterministic card-role classification. */
  roles?: DeckRoleProfile;
  /** Deterministic strategy-tag classification. */
  tags?: DeckTagProfile;
  /** Deterministic deck-level strategy signals. */
  strategy?: DeckStrategyProfile;
  /** Deterministic archetype and theme inference. */
  archetypes?: DeckArchetypeProfile;
  /** Deterministic power-relevant evidence (no score). */
  power?: DeckPowerEvidence;
}
