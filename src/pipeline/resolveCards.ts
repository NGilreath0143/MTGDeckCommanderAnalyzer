import { nameLookupKeys, normalizeCardName } from '@/domain/normalizeName';
import type { ResolvedCard } from '@/domain/types';
import type { CardRepo } from '@/infra/db/cardRepo';
import { mapScryfallCard } from '@/infra/scryfall/mapScryfallCard';
import type { ScryfallClient } from '@/infra/scryfall/client';
import type { ScryfallIdentifier } from '@/infra/scryfall/types';

/**
 * Cache-first card resolution.
 *
 * Looks every requested name up in the local cache, batches the misses to
 * Scryfall, persists what comes back, and returns one map keyed by every
 * name a caller might reasonably use.
 */

export interface ResolveCardsDeps {
  cardRepo: CardRepo;
  scryfall: ScryfallClient;
}

export interface ResolveCardsResult {
  /** Keyed by normalized name; a card may appear under several keys. */
  byName: Map<string, ResolvedCard>;
  unresolvedNames: string[];
  stats: { requested: number; cacheHits: number; fetched: number; requests: number };
}

/** Index a card under its canonical name and, for DFCs, its front face. */
function indexCard(map: Map<string, ResolvedCard>, card: ResolvedCard): void {
  for (const key of nameLookupKeys(card.name)) {
    if (!map.has(key)) map.set(key, card);
  }
}

export async function resolveCards(
  names: string[],
  deps: ResolveCardsDeps,
): Promise<ResolveCardsResult> {
  const byName = new Map<string, ResolvedCard>();

  // Deduplicate requests, remembering one original spelling per key.
  const requestedByKey = new Map<string, string>();
  for (const name of names) {
    const key = normalizeCardName(name);
    if (key && !requestedByKey.has(key)) requestedByKey.set(key, name);
  }

  const allKeys = [...requestedByKey.keys()];
  for (const card of await deps.cardRepo.findByNormalizedNames(allKeys)) {
    indexCard(byName, card);
  }

  const missingKeys = allKeys.filter((key) => !byName.has(key));
  const cacheHits = allKeys.length - missingKeys.length;

  let fetched = 0;
  let requests = 0;

  if (missingKeys.length > 0) {
    // Send the user's spelling: Scryfall fuzzy-matches and canonicalises it.
    const identifiers: ScryfallIdentifier[] = missingKeys.map((key) => ({
      name: requestedByKey.get(key) ?? key,
    }));

    const result = await deps.scryfall.fetchCollection(identifiers);
    requests = result.requests;

    if (result.found.length > 0) {
      const saved = await deps.cardRepo.upsertMany(result.found.map(mapScryfallCard));
      fetched = saved.length;
      for (const card of saved) indexCard(byName, card);
    }

    /*
     * Scryfall canonicalises names, so a requested key may still be missing
     * even though its card came back ("Nazgul" requested, "Nazgûl" returned).
     * `not_found` echoes back exactly the identifiers that matched nothing,
     * so treat everything NOT echoed as resolved and alias the requested key
     * onto its card. The returned order matches the identifiers sent, minus
     * the not-found ones, which is what makes this pairing sound.
     */
    const notFoundKeys = new Set(result.notFound.map((id) => normalizeCardName(id.name)));
    const claimedKeys = missingKeys.filter((key) => !notFoundKeys.has(key));
    const savedCards = result.found.map(mapScryfallCard);

    for (const [i, key] of claimedKeys.entries()) {
      if (byName.has(key)) continue;
      const record = savedCards[i];
      if (!record) continue;
      const card = byName.get(normalizeCardName(record.name));
      if (card) byName.set(key, card);
    }
  }

  // Anything still unresolved after all of that.
  const unresolvedNames = allKeys
    .filter((key) => !byName.has(key))
    .map((key) => requestedByKey.get(key) ?? key);

  return {
    byName,
    unresolvedNames,
    stats: { requested: allKeys.length, cacheHits, fetched, requests },
  };
}
