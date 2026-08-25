import type { ResolvedCard } from './types';

/**
 * Oracle-text normalization shared by the deterministic classifiers. Pure.
 *
 * Extracted verbatim from roles.ts so role rules and tag rules read text the
 * same way. Every step here is load-bearing and was validated against live
 * Scryfall data; changing one silently changes classification behaviour.
 */

/**
 * Drop parenthetical reminder text.
 *
 * Load-bearing: Dryad Arbor's ONLY mana ability is parenthetical, and Opt's
 * scry reminder repeats "look at the top card".
 */
export function stripReminder(text: string): string {
  return text.replace(/\([^()]*\)/g, ' ');
}

/**
 * Blank out quoted spans, which is how Oracle text expresses a GRANTED ability.
 *
 * This single step resolves three separate traps: Malakir Rebirth and Feign
 * Death hide "return it to the battlefield" inside a granted death trigger, and
 * Imprisoned in the Moon hides "{T}: Add {C}" inside a quote.
 */
export function dequote(text: string): string {
  return text.replace(/"[^"]*"/g, '   ');
}

/**
 * The front face of an oracle text blob.
 *
 * Deliberately NOT cardFacts.frontFace(): that splits a TYPE LINE on a bare
 * '//', while the mapper joins oracle faces with the literal '\n//\n'.
 */
export function frontOracle(text: string): string {
  return text.split('\n//\n')[0] ?? '';
}

/** Split into sentence / line / modal-bullet units. */
export function clauses(text: string): string[] {
  return text
    .split(/(?<=[.!])\s+|\n|•/)
    .map((c) => c.trim())
    .filter(Boolean);
}

/** The text views a rule may read, computed once per card. */
export interface CardText {
  /** Front face, reminder-stripped and dequoted. The default. */
  front: string;
  /** All faces, reminder-stripped and dequoted. */
  all: string;
  /** Front face, reminder-stripped but quotes INTACT. */
  frontQuoted: string;
  /** Clauses of `front`. */
  frontClauses: string[];
  /** Lines of `front` (before clause splitting). */
  frontLines: string[];
}

export function buildCardText(card: ResolvedCard): CardText {
  const reminderless = stripReminder(card.oracleText);
  const frontRaw = frontOracle(reminderless);
  const front = dequote(frontRaw);
  return {
    front,
    all: dequote(reminderless),
    frontQuoted: frontRaw,
    frontClauses: clauses(front),
    frontLines: front.split('\n').map((l) => l.trim()).filter(Boolean),
  };
}
