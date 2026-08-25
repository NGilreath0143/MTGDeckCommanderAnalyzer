import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveCards } from '@/pipeline/resolveCards';
import { mapScryfallCard } from '@/infra/scryfall/mapScryfallCard';
import type { ScryfallCollectionResponse } from '@/infra/scryfall/types';
import { makeFakeCardRepo, makeFakeScryfall } from './fakes';

const catalogue = (
  JSON.parse(
    readFileSync('tests/fixtures/scryfall/collection-mixed.json', 'utf8'),
  ) as ScryfallCollectionResponse
).data;

const card = (name: string) => {
  const c = catalogue.find((x) => x.name === name);
  if (!c) throw new Error(`missing fixture: ${name}`);
  return c;
};

describe('resolveCards', () => {
  it('fetches on a cold cache and persists what it finds', async () => {
    const cards = makeFakeCardRepo();
    const scryfall = makeFakeScryfall(catalogue);

    const result = await resolveCards(['Sol Ring', 'Cultivate'], {
      cardRepo: cards.repo,
      scryfall: scryfall.client,
    });

    expect(result.stats).toMatchObject({ requested: 2, cacheHits: 0, fetched: 2, requests: 1 });
    expect(result.unresolvedNames).toEqual([]);
    expect(result.byName.get('sol ring')?.name).toBe('Sol Ring');
    // Persisted for next time.
    expect(cards.rows.has('sol ring')).toBe(true);
  });

  it('serves a warm cache with no network requests at all', async () => {
    const seeded = makeFakeCardRepo([mapScryfallCard(card('Sol Ring'))]);
    const scryfall = makeFakeScryfall(catalogue);

    const result = await resolveCards(['Sol Ring'], {
      cardRepo: seeded.repo,
      scryfall: scryfall.client,
    });

    expect(scryfall.requests).toBe(0);
    expect(result.stats).toMatchObject({ cacheHits: 1, fetched: 0, requests: 0 });
    expect(result.byName.get('sol ring')?.name).toBe('Sol Ring');
  });

  it('resolves a name typed without its accent (the double-keying case)', async () => {
    const cards = makeFakeCardRepo();
    const scryfall = makeFakeScryfall(catalogue);

    // The user types "Nazgul"; Scryfall returns "Nazgûl".
    const result = await resolveCards(['Nazgul'], {
      cardRepo: cards.repo,
      scryfall: scryfall.client,
    });

    expect(result.unresolvedNames).toEqual([]);
    expect(result.byName.get('nazgul')?.name).toBe('Nazgûl');
  });

  it('keeps a requested-name alias working from the cache on the second run', async () => {
    const cards = makeFakeCardRepo();
    const scryfall = makeFakeScryfall(catalogue);
    const deps = { cardRepo: cards.repo, scryfall: scryfall.client };

    await resolveCards(['Nazgul'], deps);
    const second = await resolveCards(['Nazgul'], deps);

    // "nazgul" normalizes to the stored row's own key, so the cache hits.
    expect(second.stats.requests).toBe(0);
    expect(second.byName.get('nazgul')?.name).toBe('Nazgûl');
  });

  it('resolves a DFC requested by its front face', async () => {
    const cards = makeFakeCardRepo();
    const scryfall = makeFakeScryfall(catalogue);

    const result = await resolveCards(['Malakir Rebirth'], {
      cardRepo: cards.repo,
      scryfall: scryfall.client,
    });

    expect(result.byName.get('malakir rebirth')?.name).toBe('Malakir Rebirth // Malakir Mire');
  });

  it('reports a name Scryfall does not know', async () => {
    const cards = makeFakeCardRepo();
    const scryfall = makeFakeScryfall(catalogue);

    const result = await resolveCards(['Sol Ring', 'Blergh the Unreal'], {
      cardRepo: cards.repo,
      scryfall: scryfall.client,
    });

    expect(result.unresolvedNames).toEqual(['Blergh the Unreal']);
    expect(result.byName.has('sol ring')).toBe(true);
  });

  it('deduplicates repeated names into a single lookup', async () => {
    const cards = makeFakeCardRepo();
    const scryfall = makeFakeScryfall(catalogue);

    const result = await resolveCards(['Forest', 'Forest', 'Forest'], {
      cardRepo: cards.repo,
      scryfall: scryfall.client,
    });

    expect(result.stats.requested).toBe(1);
    /*
     * "Forest" is not in this fixture catalogue (only "Snow-Covered Forest"),
     * so it is a genuine miss: one batched /cards/collection request, then one
     * /cards/named fallback. Both ask for the name exactly once — the point of
     * the test is that three identical lines never become three lookups.
     */
    expect(scryfall.requestedNames).toEqual(['Forest', 'Forest']);
  });

  it('mixes cache hits and misses in one pass', async () => {
    const seeded = makeFakeCardRepo([mapScryfallCard(card('Sol Ring'))]);
    const scryfall = makeFakeScryfall(catalogue);

    const result = await resolveCards(['Sol Ring', 'Cultivate'], {
      cardRepo: seeded.repo,
      scryfall: scryfall.client,
    });

    expect(result.stats).toMatchObject({ requested: 2, cacheHits: 1, fetched: 1 });
    expect(scryfall.requestedNames).toEqual(['Cultivate']);
  });

  it('makes no request for an empty list', async () => {
    const cards = makeFakeCardRepo();
    const scryfall = makeFakeScryfall(catalogue);
    const result = await resolveCards([], { cardRepo: cards.repo, scryfall: scryfall.client });
    expect(scryfall.requests).toBe(0);
    expect(result.byName.size).toBe(0);
  });
});
