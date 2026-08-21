import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { importDeck } from '@/pipeline/importDeck';
import { mapScryfallCard } from '@/infra/scryfall/mapScryfallCard';
import type { ScryfallCard, ScryfallCollectionResponse } from '@/infra/scryfall/types';
import { makeFakeCardRepo, makeFakeDeckRepo, makeFakeScryfall } from './fakes';

const fixture = JSON.parse(
  readFileSync('tests/fixtures/scryfall/collection-mixed.json', 'utf8'),
) as ScryfallCollectionResponse;

/** Synthesise a catalogue big enough to build a legal 100-card deck. */
function buildCatalogue(): ScryfallCard[] {
  const atraxa = fixture.data.find((c) => c.name.startsWith('Atraxa'))!;
  const forest = fixture.data.find((c) => c.name === 'Snow-Covered Forest')!;
  const extras: ScryfallCard[] = [];
  for (let i = 0; i < 70; i += 1) {
    extras.push({
      id: `spell-${i}`,
      oracle_id: `spell-oracle-${i}`,
      name: `Test Spell ${i}`,
      mana_cost: '{1}{G}',
      cmc: 2,
      type_line: 'Sorcery',
      oracle_text: 'Do a thing.',
      color_identity: ['G'],
      colors: ['G'],
      layout: 'normal',
      keywords: [],
      legalities: { commander: 'legal' },
    });
  }
  return [...fixture.data, atraxa, forest, ...extras];
}

const catalogue = buildCatalogue();

/** A legal 100-card Atraxa deck: commander + 62 spells + 37 basics. */
function validDecklist(): string {
  const lines = ["1 Atraxa, Praetors' Voice"];
  for (let i = 0; i < 62; i += 1) lines.push(`1 Test Spell ${i}`);
  lines.push('37 Snow-Covered Forest');
  return lines.join('\n');
}

const deps = () => {
  const cards = makeFakeCardRepo();
  const decks = makeFakeDeckRepo();
  const scryfall = makeFakeScryfall(catalogue);
  return {
    cards,
    decks,
    scryfall,
    deps: {
      cardRepo: cards.repo,
      deckRepo: decks.repo,
      scryfall: scryfall.client,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    },
  };
};

describe('importDeck', () => {
  it('profiles a legal 100-card deck end to end', async () => {
    const t = deps();
    const { profile } = await importDeck({ text: validDecklist(), name: 'Atraxa' }, t.deps);

    expect(profile.validation).toMatchObject({ valid: true, issues: [] });
    expect(profile.totalCards).toBe(100);
    expect(profile.commanders.map((c) => c.name)).toEqual(["Atraxa, Praetors' Voice"]);
    expect(profile.stats.landCount).toBe(37);
    expect(profile.stats.nonlandCount).toBe(63);
    // 62 spells at mana value 2; the commander is excluded from the average.
    expect(profile.stats.averageManaValue).toBe(2);
    expect(profile.name).toBe('Atraxa');
    expect(profile.generatedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('persists the deck and stamps the profile with its id', async () => {
    const t = deps();
    const { profile } = await importDeck({ text: validDecklist() }, t.deps);

    expect(t.decks.decks).toHaveLength(1);
    expect(profile.deckId).toBe('deck-1');
    // The stored copy carries the id too.
    expect(t.decks.profiles.get('deck-1')?.deckId).toBe('deck-1');

    const stored = t.decks.decks[0]!;
    expect(stored.rawText).toBe(validDecklist());
    expect(stored.entries).toHaveLength(64);
    expect(stored.entries.filter((e) => e.isCommander)).toHaveLength(1);
    expect(stored.entries.every((e) => e.scryfallId !== null)).toBe(true);
  });

  it('issues zero Scryfall requests on a second identical import', async () => {
    const t = deps();
    await importDeck({ text: validDecklist() }, t.deps);
    const firstRequests = t.scryfall.requests;
    expect(firstRequests).toBeGreaterThan(0);

    await importDeck({ text: validDecklist() }, t.deps);

    // The cache served everything the second time.
    expect(t.scryfall.requests).toBe(firstRequests);
  });

  it('skips persistence when asked', async () => {
    const t = deps();
    const { profile } = await importDeck(
      { text: validDecklist(), persist: false },
      t.deps,
    );
    expect(t.decks.decks).toHaveLength(0);
    expect(profile.deckId).toBeNull();
  });

  it('returns a 200-style profile for an invalid deck rather than throwing', async () => {
    const t = deps();
    const { profile } = await importDeck({ text: "1 Atraxa, Praetors' Voice\n1 Sol Ring" }, t.deps);

    expect(profile.validation.valid).toBe(false);
    expect(profile.validation.issues.map((i) => i.code)).toContain('DECK_SIZE');
    // Metrics are still computed.
    expect(profile.totalCards).toBe(2);
    expect(profile.stats.averageManaValue).toBe(1);
  });

  it('flags a colour-identity violation', async () => {
    const t = deps();
    const { profile } = await importDeck(
      { text: ["1 Atraxa, Praetors' Voice", '1 Lightning Bolt'].join('\n') },
      t.deps,
    );
    expect(profile.validation.issues.map((i) => i.code)).toContain('COLOR_IDENTITY');
  });

  it('flags a banned card', async () => {
    const t = deps();
    const { profile } = await importDeck(
      { text: ["1 Atraxa, Praetors' Voice", '1 Black Lotus'].join('\n') },
      t.deps,
    );
    expect(profile.validation.issues.map((i) => i.code)).toContain('BANNED');
  });

  it('flags a singleton violation', async () => {
    const t = deps();
    const { profile } = await importDeck(
      { text: ["1 Atraxa, Praetors' Voice", '2 Test Spell 0'].join('\n') },
      t.deps,
    );
    expect(profile.validation.issues.map((i) => i.code)).toContain('SINGLETON');
  });

  it('records an unresolvable name and still persists the line', async () => {
    const t = deps();
    const { profile } = await importDeck(
      { text: ["1 Atraxa, Praetors' Voice", '1 Blergh the Unreal'].join('\n') },
      t.deps,
    );

    expect(profile.unresolved).toEqual([
      { name: 'Blergh the Unreal', quantity: 1, reason: expect.any(String) },
    ]);
    const stored = t.decks.decks[0]!;
    const unresolvedRow = stored.entries.find((e) => e.rawName === 'Blergh the Unreal');
    expect(unresolvedRow?.scryfallId).toBeNull();
  });

  it('reports cache statistics', async () => {
    const t = deps();
    const { stats } = await importDeck({ text: '1 Sol Ring\n1 Cultivate' }, t.deps);
    expect(stats).toMatchObject({ requested: 2, cacheHits: 0, fetched: 2 });
  });

  it('serves a warm cache seeded from a previous import', async () => {
    const seeded = makeFakeCardRepo(
      fixture.data.filter((c) => c.name === 'Sol Ring').map(mapScryfallCard),
    );
    const decks = makeFakeDeckRepo();
    const scryfall = makeFakeScryfall(catalogue);
    const { stats } = await importDeck(
      { text: '1 Sol Ring' },
      { cardRepo: seeded.repo, deckRepo: decks.repo, scryfall: scryfall.client },
    );
    expect(stats).toMatchObject({ cacheHits: 1, requests: 0 });
  });
});
