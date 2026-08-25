import { isLand } from '@/domain/cardFacts';
import { classifyCardRoles } from '@/domain/roles';
import type { CardRole, ResolvedCard } from '@/domain/types';

/**
 * DEVELOPER TOOLING ONLY (see bulkCards.ts).
 *
 * Suspicious-case detectors. These are REVIEW SIGNALS, never failures: a land
 * classified as ramp is not inherently wrong (Treasure Vault and Heap Gate
 * genuinely accelerate beyond their own land drop), so these outputs exist to
 * put cases in front of a human, not to gate a build.
 */

export interface SuspiciousCase {
  /** Stable identifier for the signal that fired. */
  signal: string;
  cardName: string;
  roles: CardRole[];
  ruleIds: string[];
  /** Why this combination is worth a look. */
  reason: string;
}

interface SignalDefinition {
  id: string;
  reason: string;
  applies(card: ResolvedCard, roles: Set<CardRole>): boolean;
}

const SIGNALS: SignalDefinition[] = [
  {
    id: 'land-as-ramp',
    reason:
      'A land classified as ramp. Often correct (Treasure/Powerstone lands) but ' +
      'worth confirming it is not merely tapping for mana.',
    applies: (card, roles) => isLand(card) && roles.has('ramp'),
  },
  {
    id: 'tutor-and-selection',
    reason:
      'Tutors are excluded from card_selection by specification, so both together ' +
      'indicates the exclusion did not apply.',
    applies: (_card, roles) => roles.has('tutor') && roles.has('card_selection'),
  },
  {
    // Narrowed to Overload specifically. The broader "wipe without interaction"
    // form fired on every ordinary unconditional wipe (Damnation, Toxic Deluge,
    // Austere Command), which is normal and made the signal pure noise.
    id: 'overload-without-base-mode',
    reason:
      'An Overload card earns board_wipe from the keyword, but its targeted base ' +
      'mode should normally also earn interaction. Missing it suggests the base ' +
      'mode was not matched.',
    applies: (card, roles) =>
      roles.has('board_wipe') &&
      !roles.has('interaction') &&
      card.keywords.some((k) => /^overload$/i.test(k)),
  },
  {
    id: 'recursion-and-graveyard-hate',
    reason:
      'Using and attacking graveyards at once is unusual; verify the card is not ' +
      'paying its own exile cost (the Yawgmoth\'s Will shape).',
    applies: (_card, roles) => roles.has('recursion') && roles.has('graveyard_hate'),
  },
  {
    id: 'many-roles',
    reason: 'Four or more roles on one card is rare and may indicate over-matching.',
    applies: (_card, roles) => roles.size >= 4,
  },
  {
    id: 'basic-land-any-role',
    reason: 'A basic land should never carry a functional role.',
    applies: (card, roles) =>
      roles.size > 0 && isLand(card) && /\bBasic\b/i.test(card.typeLine),
  },
];

/** Run every detector over one card. */
export function findSuspiciousCases(card: ResolvedCard): SuspiciousCase[] {
  const { assignments } = classifyCardRoles(card);
  if (assignments.length === 0) return [];

  const roles = new Set(assignments.map((a) => a.role));
  const out: SuspiciousCase[] = [];
  for (const signal of SIGNALS) {
    if (!signal.applies(card, roles)) continue;
    out.push({
      signal: signal.id,
      cardName: card.name,
      roles: [...roles],
      ruleIds: [...new Set(assignments.map((a) => a.ruleId))],
      reason: signal.reason,
    });
  }
  return out;
}

export const SUSPICIOUS_SIGNAL_IDS: readonly string[] = SIGNALS.map((s) => s.id);
