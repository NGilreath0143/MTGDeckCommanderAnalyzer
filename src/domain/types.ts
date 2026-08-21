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
 * The structured result of profiling a decklist.
 *
 * Later features attach as optional sibling keys, so nothing here changes:
 *   roles?: CardRoleAssignment[]
 *   strategy?: StrategyProfile
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
}
