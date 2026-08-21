import type { ColorCode, Legality, ResolvedCard } from '@/domain/types';

let seq = 0;

/** Build a ResolvedCard for tests; override only what the test cares about. */
export function makeCard(overrides: Partial<ResolvedCard> = {}): ResolvedCard {
  seq += 1;
  return {
    scryfallId: `card-${seq}`,
    oracleId: `oracle-${seq}`,
    name: `Test Card ${seq}`,
    manaCost: '{1}',
    cmc: 1,
    typeLine: 'Artifact',
    colorIdentity: [],
    colors: [],
    layout: 'normal',
    keywords: [],
    oracleText: '',
    commanderLegality: 'legal' as Legality,
    ...overrides,
  };
}

export function basicLand(name: string, color: ColorCode): ResolvedCard {
  return makeCard({
    name,
    typeLine: `Basic Land — ${name}`,
    manaCost: '',
    cmc: 0,
    colorIdentity: [color],
  });
}

export function legendaryCreature(
  name: string,
  colorIdentity: ColorCode[],
  overrides: Partial<ResolvedCard> = {},
): ResolvedCard {
  return makeCard({
    name,
    typeLine: 'Legendary Creature — Human Wizard',
    cmc: 4,
    manaCost: '{2}{W}{U}',
    colorIdentity,
    ...overrides,
  });
}

/**
 * A valid-by-construction deck: one commander plus 99 mainboard cards,
 * all inside the commander's colour identity.
 */
export function makeValidDeck(): {
  commanders: ResolvedCard[];
  mainboard: { card: ResolvedCard; quantity: number }[];
} {
  const commander = legendaryCreature('Test Commander', ['W', 'U']);
  const mainboard: { card: ResolvedCard; quantity: number }[] = [];

  // 37 basic lands (duplicates are legal).
  mainboard.push({ card: basicLand('Plains', 'W'), quantity: 37 });

  // 62 distinct nonland cards, all mono-white, cmc 2.
  for (let i = 0; i < 62; i += 1) {
    mainboard.push({
      card: makeCard({
        name: `Spell ${i}`,
        typeLine: 'Instant',
        manaCost: '{1}{W}',
        cmc: 2,
        colorIdentity: ['W'],
        colors: ['W'],
      }),
      quantity: 1,
    });
  }

  return { commanders: [commander], mainboard };
}
