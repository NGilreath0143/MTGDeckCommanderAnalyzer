import { buildDeckProfile } from '@/domain/buildProfile';
import { parseDecklist } from '@/domain/parseDecklist';
import { nameLookupKeys } from '@/domain/normalizeName';
import type { DeckProfile, ParsedDeck, ResolvedCard } from '@/domain/types';
import type { CardRepo } from '@/infra/db/cardRepo';
import type { DeckCardInput, DeckRepo } from '@/infra/db/deckRepo';
import { createScryfallClient, type ScryfallClient } from '@/infra/scryfall/client';
import { resolveCards } from './resolveCards';

/**
 * The one orchestrator: decklist text in, DeckProfile out.
 *
 * All analysis lives in the pure domain layer; this function only sequences
 * I/O around it. Deps default to the real implementations so callers stay
 * clean while tests inject fakes.
 */

export interface ImportDeckInput {
  text: string;
  name?: string | null;
  /** Persist the deck. Defaults to true. */
  persist?: boolean;
}

export interface ImportDeckDeps {
  cardRepo: CardRepo;
  deckRepo: DeckRepo;
  scryfall: ScryfallClient;
  now?: () => Date;
}

export interface ImportDeckResult {
  profile: DeckProfile;
  stats: { requested: number; cacheHits: number; fetched: number; requests: number };
}

/**
 * Real dependencies, imported lazily so that callers who inject their own
 * (tests, and any future non-Postgres consumer) never load Prisma at all.
 */
async function defaultDeps(): Promise<ImportDeckDeps> {
  const [{ cardRepo }, { deckRepo }] = await Promise.all([
    import('@/infra/db/cardRepo'),
    import('@/infra/db/deckRepo'),
  ]);
  return { cardRepo, deckRepo, scryfall: createScryfallClient() };
}

/** Map parsed lines to persistable rows, tagging the commander(s). */
function toDeckCardInputs(
  parsed: ParsedDeck,
  resolved: Map<string, ResolvedCard>,
  commanderIds: Set<string>,
): DeckCardInput[] {
  return parsed.entries.map((entry) => {
    const card = nameLookupKeys(entry.name)
      .map((key) => resolved.get(key))
      .find((c): c is ResolvedCard => c !== undefined);

    return {
      rawName: entry.name,
      quantity: entry.quantity,
      section: entry.section,
      isCommander: card ? commanderIds.has(card.scryfallId) : false,
      lineNumber: entry.lineNumber,
      scryfallId: card?.scryfallId ?? null,
    };
  });
}

export async function importDeck(
  input: ImportDeckInput,
  injectedDeps?: ImportDeckDeps,
): Promise<ImportDeckResult> {
  const deps = injectedDeps ?? (await defaultDeps());
  const parsed = parseDecklist(input.text);

  const uniqueNames = [...new Set(parsed.entries.map((e) => e.name))];
  const { byName, stats } = await resolveCards(uniqueNames, {
    cardRepo: deps.cardRepo,
    scryfall: deps.scryfall,
  });

  const profile = buildDeckProfile({
    parsed,
    resolved: byName,
    name: input.name ?? null,
    now: deps.now,
  });

  if (input.persist === false) return { profile, stats };

  const commanderIds = new Set(profile.commanders.map((c) => c.scryfallId));
  const deck = await deps.deckRepo.create({
    name: input.name ?? null,
    rawText: input.text,
    entries: toDeckCardInputs(parsed, byName, commanderIds),
    profile,
  });

  // Persist the profile with its own deck id so the stored copy is complete.
  const withId: DeckProfile = { ...profile, deckId: deck.id };
  await deps.deckRepo.updateProfile(deck.id, withId);

  return { profile: withId, stats };
}
