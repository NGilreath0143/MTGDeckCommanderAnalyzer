import { normalizeCardName } from '@/domain/normalizeName';
import type { DeckProfile, ResolvedCard } from '@/domain/types';
import { mapCardRow } from '@/infra/db/mapCardRow';
import type { CardRepo } from '@/infra/db/cardRepo';
import type { CreateDeckInput, DeckRepo } from '@/infra/db/deckRepo';
import type { CardRecordInput } from '@/infra/scryfall/mapScryfallCard';
import type { ScryfallCard } from '@/infra/scryfall/types';
import type { CollectionResult, ScryfallClient } from '@/infra/scryfall/client';

/** In-memory CardRepo backed by a Map, keyed like the real unique index. */
export function makeFakeCardRepo(seed: CardRecordInput[] = []) {
  const rows = new Map<string, CardRecordInput>();
  for (const r of seed) rows.set(r.normalizedName, r);

  let findCalls = 0;
  let upsertCalls = 0;

  const repo: CardRepo = {
    async findByNormalizedNames(keys) {
      findCalls += 1;
      return keys
        .map((k) => rows.get(k))
        .filter((r): r is CardRecordInput => r !== undefined)
        .map(mapCardRow);
    },
    async upsertMany(records) {
      upsertCalls += 1;
      const out: ResolvedCard[] = [];
      for (const r of records) {
        rows.set(r.normalizedName, r);
        out.push(mapCardRow(r));
      }
      return out;
    },
  };

  return {
    repo,
    rows,
    get findCalls() {
      return findCalls;
    },
    get upsertCalls() {
      return upsertCalls;
    },
  };
}

/**
 * Fake Scryfall client over a fixed card catalogue. Matches names the way the
 * real API does: canonical name, front face, or normalized equality.
 */
export function makeFakeScryfall(catalogue: ScryfallCard[]) {
  let requests = 0;
  const requestedNames: string[] = [];

  const client: ScryfallClient = {
    async fetchCollection(identifiers) {
      if (identifiers.length === 0) return { found: [], notFound: [], requests: 0 };
      requests += 1;
      requestedNames.push(...identifiers.map((i) => i.name));

      const found: ScryfallCard[] = [];
      const notFound: typeof identifiers = [];

      for (const id of identifiers) {
        const key = normalizeCardName(id.name);
        const hit = catalogue.find((c) => {
          const canonical = normalizeCardName(c.name);
          const front = normalizeCardName(c.name.split('//')[0] ?? c.name);
          return canonical === key || front === key;
        });
        if (hit) found.push(hit);
        else notFound.push(id);
      }

      return { found, notFound, requests: 1 } satisfies CollectionResult;
    },

    /*
     * The fallback path. These fakes model /cards/collection's stricter
     * matching, so the fake `named` endpoint is deliberately no more
     * permissive than the collection one — it exists so the client shape is
     * satisfied and the fallback is exercised, not to invent extra hits.
     */
    async fetchNamed(name) {
      requests += 1;
      requestedNames.push(name);
      const key = normalizeCardName(name);
      const hit = catalogue.find((c) => {
        const canonical = normalizeCardName(c.name);
        const front = normalizeCardName(c.name.split('//')[0] ?? c.name);
        return canonical === key || front === key;
      });
      return { card: hit ?? null, requests: 1 };
    },
  };

  return {
    client,
    get requests() {
      return requests;
    },
    requestedNames,
  };
}

export function makeFakeDeckRepo() {
  const decks: (CreateDeckInput & { id: string })[] = [];
  const profiles = new Map<string, DeckProfile>();

  const repo: DeckRepo = {
    async create(input) {
      const id = `deck-${decks.length + 1}`;
      decks.push({ ...input, id });
      return { id };
    },
    async updateProfile(deckId, profile) {
      profiles.set(deckId, profile);
    },
  };

  return { repo, decks, profiles };
}
