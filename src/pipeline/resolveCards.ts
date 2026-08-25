import {
  frontFaceName as domainFrontFaceName,
  nameLookupKeys,
  normalizeCardName,
} from '@/domain/normalizeName';
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

/**
 * How many single-name /cards/named requests one import may issue.
 * Bounds the cost of a decklist full of unresolvable lines.
 */
const NAMED_FALLBACK_LIMIT = 10;

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

/**
 * The front-face name of a multi-face card name, or null when there is none.
 *
 * Reuses the same ` // ` split `nameLookupKeys` relies on rather than adding a
 * second parser for multi-face names.
 */
function frontFaceName(name: string): string | null {
  const front = domainFrontFaceName(name);
  if (front === '' || front === name.trim()) return null;
  return front;
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

    /*
     * Multi-face retry.
     *
     * `/cards/collection` matches a multi-face card by its FRONT FACE only and
     * returns not_found for the full canonical `A // B` name — verified live
     * across every family: modal DFCs (Birgi, Sink into Stupor, Agadeem's
     * Awakening), transforming DFCs (Malakir Rebirth), pathway lands
     * (Clearwater Pathway) and split cards (Wear // Tear). This is the reverse
     * of `/cards/named`, which accepts either form.
     *
     * A decklist exported from most tools writes the full canonical name, so
     * every such card was silently unresolved: 26 of 38 analyzer-valid cEDH
     * lists in the Phase 5A.2 corpus were affected.
     *
     * Retry those with the front-face name that `nameLookupKeys` already
     * derives, then alias the ORIGINAL requested key onto the resolved card so
     * the caller's spelling still finds it. Only names Scryfall explicitly
     * rejected are retried, and only when a front face actually differs from
     * what was already sent, so an ordinary miss is not retried and a typo
     * cannot be coerced into a match.
     */
    const stillMissing = missingKeys.filter((key) => !byName.has(key));
    const frontFaceRetry = new Map<string, string>();
    for (const key of stillMissing) {
      const requested = requestedByKey.get(key) ?? key;
      const front = frontFaceName(requested);
      if (front === null) continue;
      const frontKey = normalizeCardName(front);
      if (!frontKey || frontKey === key) continue;
      // A card already resolved under the front-face key needs no request.
      const existing = byName.get(frontKey);
      if (existing) {
        byName.set(key, existing);
        continue;
      }
      frontFaceRetry.set(key, front);
    }

    if (frontFaceRetry.size > 0) {
      const retryKeys = [...frontFaceRetry.keys()];
      const retry = await deps.scryfall.fetchCollection(
        retryKeys.map((key) => ({ name: frontFaceRetry.get(key)! })),
      );
      requests += retry.requests;

      if (retry.found.length > 0) {
        const savedRetry = await deps.cardRepo.upsertMany(retry.found.map(mapScryfallCard));
        fetched += savedRetry.length;
        for (const card of savedRetry) indexCard(byName, card);
      }

      /*
       * Same echoed-identifier pairing as above, but keyed on the FRONT-FACE
       * name we sent rather than the original request.
       */
      const retryNotFound = new Set(retry.notFound.map((id) => normalizeCardName(id.name)));
      const retryRecords = retry.found.map(mapScryfallCard);
      const claimedRetry = retryKeys.filter(
        (key) => !retryNotFound.has(normalizeCardName(frontFaceRetry.get(key)!)),
      );
      for (const [i, key] of claimedRetry.entries()) {
        if (byName.has(key)) continue;
        const record = retryRecords[i];
        if (!record) continue;
        const card = byName.get(normalizeCardName(record.name));
        // Alias the caller's original spelling onto the canonical card.
        if (card) byName.set(key, card);
      }
    }

    /*
     * Last-resort /cards/named fallback.
     *
     * The two endpoints disagree: /cards/collection rejects some names that
     * /cards/named resolves. Verified live on "Aang's Shelter" (an
     * Avatar: The Last Airbender alternate name for Teferi's Protection),
     * which /cards/collection returns in not_found under every spelling.
     *
     * One request per name, so it is bounded deliberately: only names that
     * BOTH the batch request and the front-face retry failed to resolve, and
     * at most NAMED_FALLBACK_LIMIT of them. A list full of typos therefore
     * costs a handful of requests, not one per bad line.
     */
    const unresolvedAfterRetry = missingKeys.filter((key) => !byName.has(key));
    for (const key of unresolvedAfterRetry.slice(0, NAMED_FALLBACK_LIMIT)) {
      const requested = requestedByKey.get(key) ?? key;
      const named = await deps.scryfall.fetchNamed(requested);
      requests += named.requests;
      if (!named.card) continue;

      const [saved] = await deps.cardRepo.upsertMany([mapScryfallCard(named.card)]);
      if (!saved) continue;
      fetched += 1;
      indexCard(byName, saved);
      // Alias the caller's spelling onto the canonical card.
      if (!byName.has(key)) byName.set(key, saved);
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
