import { describe, expect, it } from 'vitest';
import { buildDeckProfile, composeDeck } from '@/domain/buildProfile';
import { parseDecklist } from '@/domain/parseDecklist';
import { normalizeCardName } from '@/domain/normalizeName';
import type { ResolvedCard } from '@/domain/types';
import { basicLand, legendaryCreature, makeCard } from '../fixtures/cards';

/** Index cards the way resolveCards does, under every lookup key. */
function index(cards: ResolvedCard[]): Map<string, ResolvedCard> {
  const map = new Map<string, ResolvedCard>();
  for (const card of cards) map.set(normalizeCardName(card.name), card);
  return map;
}

const atraxa = legendaryCreature('Atraxa, Praetors\' Voice', ['W', 'U', 'B', 'G'], {
  typeLine: 'Legendary Creature — Phyrexian Angel Horror',
  cmc: 4,
  manaCost: '{G}{W}{U}{B}',
});
// Real oracle text, so role classification exercises genuine wording.
const solRing = makeCard({
  name: 'Sol Ring',
  typeLine: 'Artifact',
  cmc: 1,
  manaCost: '{1}',
  oracleText: '{T}: Add {C}{C}.',
});
const cultivate = makeCard({
  name: 'Cultivate',
  typeLine: 'Sorcery',
  cmc: 3,
  manaCost: '{2}{G}',
  colorIdentity: ['G'],
  oracleText:
    'Search your library for up to two basic land cards, reveal those cards, ' +
    'put one onto the battlefield tapped and the other into your hand, then shuffle.',
});
const forest = basicLand('Forest', 'G');

describe('composeDeck', () => {
  it('infers the commander from a plain list and removes it from the mainboard', () => {
    const parsed = parseDecklist(["1 Atraxa, Praetors' Voice", '1 Sol Ring'].join('\n'));
    const { composition } = composeDeck(parsed, index([atraxa, solRing]));
    expect(composition.commanders.map((c) => c.name)).toEqual(["Atraxa, Praetors' Voice"]);
    expect(composition.mainboard.map((e) => e.card.name)).toEqual(['Sol Ring']);
  });

  it('honours an explicit Commander section over line order', () => {
    const parsed = parseDecklist(
      ['1 Sol Ring', 'Commander:', "1 Atraxa, Praetors' Voice"].join('\n'),
    );
    const { composition } = composeDeck(parsed, index([atraxa, solRing]));
    expect(composition.commanders.map((c) => c.name)).toEqual(["Atraxa, Praetors' Voice"]);
    expect(composition.mainboard).toHaveLength(1);
  });

  it('reports unresolved names without throwing', () => {
    const parsed = parseDecklist(['1 Sol Ring', '1 Blergh the Unreal'].join('\n'));
    const { unresolved, issues } = composeDeck(parsed, index([solRing]));
    expect(unresolved).toEqual([
      { name: 'Blergh the Unreal', quantity: 1, reason: expect.any(String) },
    ]);
    expect(issues.map((i) => i.code)).toContain('UNRESOLVED_CARDS');
  });

  it('resolves a name the user typed without its accent', () => {
    // Scryfall canonicalises to "Nazgûl"; the user typed "Nazgul".
    const nazgul = makeCard({ name: 'Nazgûl', typeLine: 'Creature — Wraith Knight', cmc: 3 });
    const parsed = parseDecklist('1 Nazgul');
    const { composition, unresolved } = composeDeck(parsed, index([nazgul]));
    expect(unresolved).toEqual([]);
    expect(composition.mainboard[0]?.card.name).toBe('Nazgûl');
  });

  it('resolves a DFC typed by its front face alone', () => {
    const dfc = makeCard({
      name: 'Malakir Rebirth // Malakir Mire',
      typeLine: 'Instant // Land',
      cmc: 1,
    });
    const map = new Map<string, ResolvedCard>([
      ['malakir rebirth malakir mire', dfc],
      ['malakir rebirth', dfc],
    ]);
    const { composition } = composeDeck(parseDecklist('1 Malakir Rebirth'), map);
    expect(composition.mainboard[0]?.card.name).toBe('Malakir Rebirth // Malakir Mire');
  });

  it('excludes sideboard entries from the deck', () => {
    const parsed = parseDecklist(
      ["1 Atraxa, Praetors' Voice", '1 Sol Ring', 'Sideboard', '1 Cultivate'].join('\n'),
    );
    const { composition } = composeDeck(parsed, index([atraxa, solRing, cultivate]));
    expect(composition.mainboard.map((e) => e.card.name)).toEqual(['Sol Ring']);
  });

  it('keeps an extra copy of the commander in the mainboard so singleton still catches it', () => {
    const parsed = parseDecklist(["2 Atraxa, Praetors' Voice"].join('\n'));
    const { composition } = composeDeck(parsed, index([atraxa]));
    expect(composition.commanders).toHaveLength(1);
    expect(composition.mainboard).toEqual([{ card: atraxa, quantity: 1 }]);
  });
});

describe('buildDeckProfile', () => {
  const now = () => new Date('2026-01-01T00:00:00.000Z');

  it('produces a complete profile for a small list', () => {
    const parsed = parseDecklist(
      ["1 Atraxa, Praetors' Voice", '1 Sol Ring', '1 Cultivate', '10 Forest'].join('\n'),
    );
    const profile = buildDeckProfile({
      parsed,
      resolved: index([atraxa, solRing, cultivate, forest]),
      now,
    });

    expect(profile.commanders).toEqual([
      expect.objectContaining({
        name: "Atraxa, Praetors' Voice",
        eligibility: 'legendary-creature',
        colorIdentity: ['W', 'U', 'B', 'G'],
      }),
    ]);
    expect(profile.totalCards).toBe(13);
    expect(profile.stats.landCount).toBe(10);
    // Sol Ring (1) and Cultivate (3): the commander is excluded.
    expect(profile.stats.averageManaValue).toBe(2);
    expect(profile.generatedAt).toBe('2026-01-01T00:00:00.000Z');
    // 13 cards, not 100.
    expect(profile.validation.valid).toBe(false);
    expect(profile.validation.issues.map((i) => i.code)).toContain('DECK_SIZE');
  });

  it('attaches role analysis to the profile', () => {
    const parsed = parseDecklist(
      ["1 Atraxa, Praetors' Voice", '1 Sol Ring', '1 Cultivate', '10 Forest'].join('\n'),
    );
    const profile = buildDeckProfile({
      parsed,
      resolved: index([atraxa, solRing, cultivate, forest]),
      now,
    });

    // Sol Ring's mana ability and Cultivate's land search are both ramp.
    expect(profile.roles?.counts.ramp).toBe(2);
    expect(profile.roles?.cardsByRole.ramp).toEqual(['Sol Ring', 'Cultivate']);
    // Every role key is always present, so consumers need no existence checks.
    expect(Object.keys(profile.roles?.counts ?? {})).toHaveLength(9);
  });

  it('attaches strategy-tag analysis to the profile', () => {
    const parsed = parseDecklist(
      ["1 Atraxa, Praetors' Voice", '1 Sol Ring', '1 Cultivate', '10 Forest'].join('\n'),
    );
    const profile = buildDeckProfile({
      parsed,
      resolved: index([atraxa, solRing, cultivate, forest]),
      now,
    });

    // Every tag key is always present, so consumers need no existence checks.
    expect(Object.keys(profile.tags?.counts ?? {})).toHaveLength(39);
    // None of these four cards participates in a tagged strategy.
    const total = Object.values(profile.tags?.counts ?? {}).reduce((a, b) => a + b, 0);
    expect(total).toBe(0);
  });

  it('surfaces parse errors on the profile', () => {
    const profile = buildDeckProfile({
      parsed: parseDecklist(['1 Sol Ring', '@@@@'].join('\n')),
      resolved: index([solRing]),
      now,
    });
    expect(profile.parseErrors).toHaveLength(1);
    expect(profile.parseErrors[0]?.lineNumber).toBe(2);
  });

  it('reports no commander when none is eligible', () => {
    const profile = buildDeckProfile({
      parsed: parseDecklist('1 Sol Ring'),
      resolved: index([solRing]),
      now,
    });
    expect(profile.commanders).toEqual([]);
    expect(profile.validation.issues.map((i) => i.code)).toContain('NO_COMMANDER');
  });

  it('identifies a commander that qualifies only by oracle text', () => {
    // Estrid prints the clause outright (32 such cards exist).
    const grist = makeCard({
      name: 'Estrid, the Masked',
      typeLine: 'Legendary Planeswalker — Estrid',
      cmc: 3,
      colorIdentity: ['W', 'U'],
      oracleText: 'Estrid, the Masked can be your commander.',
    });
    const profile = buildDeckProfile({
      parsed: parseDecklist('1 Estrid, the Masked'),
      resolved: index([grist]),
      now,
    });
    expect(profile.commanders[0]).toMatchObject({
      name: 'Estrid, the Masked',
      eligibility: 'can-be-your-commander',
    });
  });
});
