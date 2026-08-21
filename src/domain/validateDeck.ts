import { isBasicLand, isLegalInCommander } from './cardFacts';
import { combinedColorIdentity } from './commander';
import type {
  ColorCode,
  DeckComposition,
  ResolvedCard,
  ValidationIssue,
  ValidationResult,
} from './types';

/**
 * Commander deck validation. Pure.
 *
 * Each rule is its own exported function: small, individually testable, and
 * adding a rule later is a new function plus one line in validateDeck.
 */

export const COMMANDER_DECK_SIZE = 100;

/** Commanders plus mainboard, counting quantities. */
function totalCards(c: DeckComposition): number {
  const main = c.mainboard.reduce((sum, e) => sum + e.quantity, 0);
  return main + c.commanders.length;
}

/** Every card in the deck, commanders included, with quantities. */
function allEntries(c: DeckComposition): { card: ResolvedCard; quantity: number }[] {
  return [...c.commanders.map((card) => ({ card, quantity: 1 })), ...c.mainboard];
}

export function validateDeckSize(c: DeckComposition): ValidationIssue[] {
  const total = totalCards(c);
  if (total === COMMANDER_DECK_SIZE) return [];
  return [
    {
      code: 'DECK_SIZE',
      severity: 'error',
      message: `A Commander deck must contain exactly ${COMMANDER_DECK_SIZE} cards; found ${total}.`,
      details: { expected: COMMANDER_DECK_SIZE, actual: total },
    },
  ];
}

/**
 * Singleton: at most one copy of any card, basic lands exempt.
 * Cards are compared by oracle id so two printings of the same card collide.
 */
export function validateSingleton(c: DeckComposition): ValidationIssue[] {
  const counts = new Map<string, { card: ResolvedCard; count: number }>();
  for (const { card, quantity } of allEntries(c)) {
    if (isBasicLand(card)) continue;
    const existing = counts.get(card.oracleId);
    if (existing) existing.count += quantity;
    else counts.set(card.oracleId, { card, count: quantity });
  }

  const offenders = [...counts.values()].filter((e) => e.count > 1);
  if (offenders.length === 0) return [];
  return [
    {
      code: 'SINGLETON',
      severity: 'error',
      message:
        `Singleton rule violated by ${offenders.length} card(s): ` +
        offenders.map((o) => `${o.card.name} (${o.count})`).join(', '),
      cardNames: offenders.map((o) => o.card.name),
    },
  ];
}

/** Every card must fall inside the commanders' combined colour identity. */
export function validateColorIdentity(c: DeckComposition): ValidationIssue[] {
  if (c.commanders.length === 0) return [];
  const allowed = new Set<ColorCode>(combinedColorIdentity(c.commanders));

  const offenders = c.mainboard
    .map((e) => e.card)
    .filter((card) => card.colorIdentity.some((color) => !allowed.has(color)));

  if (offenders.length === 0) return [];
  return [
    {
      code: 'COLOR_IDENTITY',
      severity: 'error',
      message:
        `${offenders.length} card(s) fall outside the commander colour identity ` +
        `{${[...allowed].join('')}}: ${offenders.map((o) => o.name).join(', ')}`,
      cardNames: offenders.map((o) => o.name),
      details: { allowed: [...allowed] },
    },
  ];
}

/** Reject cards that are banned or simply not legal in Commander. */
export function validateLegality(c: DeckComposition): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const entries = allEntries(c).map((e) => e.card);

  const banned = entries.filter((card) => card.commanderLegality === 'banned');
  if (banned.length > 0) {
    issues.push({
      code: 'BANNED',
      severity: 'error',
      message: `Banned in Commander: ${banned.map((c2) => c2.name).join(', ')}`,
      cardNames: banned.map((c2) => c2.name),
    });
  }

  const notLegal = entries.filter(
    (card) => !isLegalInCommander(card) && card.commanderLegality !== 'banned',
  );
  if (notLegal.length > 0) {
    issues.push({
      code: 'NOT_LEGAL',
      severity: 'error',
      message: `Not legal in Commander: ${notLegal.map((c2) => c2.name).join(', ')}`,
      cardNames: notLegal.map((c2) => c2.name),
    });
  }

  return issues;
}

/**
 * Run every rule. `priorIssues` carries in issues found earlier in the
 * pipeline (commander identification, unresolved cards) so the caller gets a
 * single verdict.
 */
export function validateDeck(
  composition: DeckComposition,
  priorIssues: ValidationIssue[] = [],
): ValidationResult {
  const issues = [
    ...priorIssues,
    ...validateDeckSize(composition),
    ...validateSingleton(composition),
    ...validateColorIdentity(composition),
    ...validateLegality(composition),
  ];
  return { valid: !issues.some((i) => i.severity === 'error'), issues };
}
