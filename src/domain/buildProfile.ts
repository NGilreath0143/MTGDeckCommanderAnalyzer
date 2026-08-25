import { computeStats } from './computeStats';
import { identifyCommanders, toCommanderInfo } from './commander';
import { analyzeDeckRoles } from './roles';
import { analyzeDeckTags } from './tags';
import { analyzeDeckStrategy } from './strategy';
import { inferDeckArchetypes } from './archetypes';
import { nameLookupKeys } from './normalizeName';
import { validateDeck } from './validateDeck';
import type {
  DeckComposition,
  DeckProfile,
  ParsedDeck,
  ResolvedCard,
  UnresolvedEntry,
  ValidationIssue,
} from './types';

/**
 * The pure entry point of the analysis engine: parsed text plus a map of
 * resolved cards in, a complete DeckProfile out. No I/O, so the entire
 * engine is testable with plain objects.
 */

/** Look a parsed name up under any of its normalized keys. */
function findCard(
  name: string,
  resolved: Map<string, ResolvedCard>,
): ResolvedCard | undefined {
  for (const key of nameLookupKeys(name)) {
    const hit = resolved.get(key);
    if (hit) return hit;
  }
  return undefined;
}

export interface ComposeResult {
  composition: DeckComposition;
  unresolved: UnresolvedEntry[];
  issues: ValidationIssue[];
}

/**
 * Join parsed lines to resolved cards, split out the commander(s), and
 * collect anything that could not be resolved.
 *
 * Sideboard entries are excluded: Commander has no sideboard, so they are
 * neither counted toward 100 nor validated.
 */
export function composeDeck(
  parsed: ParsedDeck,
  resolved: Map<string, ResolvedCard>,
): ComposeResult {
  const unresolved: UnresolvedEntry[] = [];
  const joined: { card: ResolvedCard; quantity: number; section: ParsedDeck['entries'][number]['section'] }[] = [];

  for (const entry of parsed.entries) {
    if (entry.section === 'sideboard') continue;
    const card = findCard(entry.name, resolved);
    if (!card) {
      unresolved.push({
        name: entry.name,
        quantity: entry.quantity,
        reason: 'No matching card found on Scryfall',
      });
      continue;
    }
    joined.push({ card, quantity: entry.quantity, section: entry.section });
  }

  const { commanders, issues } = identifyCommanders(joined);

  // Remove exactly the commander copies from the mainboard, leaving any
  // additional copies in place so the singleton rule can still catch them.
  const remainingCommanders = new Map<string, number>();
  for (const c of commanders) {
    remainingCommanders.set(c.scryfallId, (remainingCommanders.get(c.scryfallId) ?? 0) + 1);
  }

  const mainboard: { card: ResolvedCard; quantity: number }[] = [];
  for (const item of joined) {
    const toRemove = remainingCommanders.get(item.card.scryfallId) ?? 0;
    if (toRemove > 0) {
      const removed = Math.min(toRemove, item.quantity);
      remainingCommanders.set(item.card.scryfallId, toRemove - removed);
      const left = item.quantity - removed;
      if (left > 0) mainboard.push({ card: item.card, quantity: left });
      continue;
    }
    mainboard.push({ card: item.card, quantity: item.quantity });
  }

  if (unresolved.length > 0) {
    issues.push({
      code: 'UNRESOLVED_CARDS',
      severity: 'error',
      message: `${unresolved.length} card name(s) could not be resolved: ${unresolved
        .map((u) => u.name)
        .join(', ')}`,
      cardNames: unresolved.map((u) => u.name),
    });
  }

  return { composition: { commanders, mainboard }, unresolved, issues };
}

export interface BuildProfileInput {
  parsed: ParsedDeck;
  resolved: Map<string, ResolvedCard>;
  deckId?: string | null;
  name?: string | null;
  /** Injected so the profile is deterministic in tests. */
  now?: () => Date;
}

export function buildDeckProfile(input: BuildProfileInput): DeckProfile {
  const { composition, unresolved, issues } = composeDeck(input.parsed, input.resolved);
  const validation = validateDeck(composition, issues);
  const stats = computeStats(composition);
  const roles = analyzeDeckRoles(composition);
  const tags = analyzeDeckTags(composition);
  const strategy = analyzeDeckStrategy(composition);
  const archetypes = inferDeckArchetypes(composition, strategy);

  return {
    deckId: input.deckId ?? null,
    name: input.name ?? null,
    commanders: composition.commanders.map(toCommanderInfo),
    totalCards: stats.totalCards,
    validation,
    stats,
    roles,
    tags,
    strategy,
    archetypes,
    unresolved,
    parseErrors: input.parsed.errors,
    generatedAt: (input.now?.() ?? new Date()).toISOString(),
  };
}
