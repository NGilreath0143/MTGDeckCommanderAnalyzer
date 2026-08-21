import { describe, expect, it } from 'vitest';
import {
  cardTypes,
  frontFace,
  isBasicLand,
  isLand,
  isLegalInCommander,
  manaPips,
  primaryCardType,
} from '@/domain/cardFacts';
import { makeCard } from '../fixtures/cards';

describe('frontFace', () => {
  it('takes the front of a modal DFC type line', () => {
    // Verified live: Malakir Rebirth // Malakir Mire -> "Instant // Land".
    expect(frontFace('Instant // Land')).toBe('Instant');
  });

  it('passes through a single type line', () => {
    expect(frontFace('Artifact')).toBe('Artifact');
  });
});

describe('primaryCardType', () => {
  it.each([
    ['Artifact', 'Artifact'],
    ['Sorcery', 'Sorcery'],
    ['Instant', 'Instant'],
    ['Enchantment', 'Enchantment'],
    ['Legendary Creature — Phyrexian Angel Horror', 'Creature'],
    ['Legendary Planeswalker — Grist', 'Planeswalker'],
    ['Basic Land', 'Land'],
    ['Basic Snow Land — Forest', 'Land'],
    // Artifact Creature counts once, as a Creature.
    ['Artifact Creature — Golem', 'Creature'],
    // Land wins so landCount and typeDistribution.Land agree.
    ['Land Creature — Forest Dryad', 'Land'],
    // Modal DFC uses the front face only.
    ['Instant // Land', 'Instant'],
    ['Legendary Enchantment Creature — Background', 'Creature'],
  ])('classifies %j as %s', (typeLine, expected) => {
    expect(primaryCardType(typeLine)).toBe(expected);
  });

  it('falls back to Other for unrecognised lines', () => {
    expect(primaryCardType('Tribal Scariness')).toBe('Other');
  });
});

describe('cardTypes', () => {
  it('reports every type on the front face', () => {
    expect(cardTypes('Artifact Creature — Golem')).toEqual(['Creature', 'Artifact']);
  });
});

describe('isLand / isBasicLand', () => {
  it('treats Wastes and Snow-Covered lands as basic', () => {
    // Both verified against the live API.
    expect(isBasicLand(makeCard({ typeLine: 'Basic Land' }))).toBe(true);
    expect(isBasicLand(makeCard({ typeLine: 'Basic Snow Land — Forest' }))).toBe(true);
  });

  it('does not treat a nonbasic land as basic', () => {
    const c = makeCard({ typeLine: 'Land' });
    expect(isLand(c)).toBe(true);
    expect(isBasicLand(c)).toBe(false);
  });

  it('recognises a land creature as a land', () => {
    expect(isLand(makeCard({ typeLine: 'Land Creature — Forest Dryad' }))).toBe(true);
  });

  it('does not treat an instant with a land back face as a land', () => {
    expect(isLand(makeCard({ typeLine: 'Instant // Land' }))).toBe(false);
  });
});

describe('isLegalInCommander', () => {
  it.each([
    ['legal', true],
    ['restricted', true],
    ['banned', false],
    ['not_legal', false],
  ] as const)('%s -> %s', (legality, expected) => {
    expect(isLegalInCommander(makeCard({ commanderLegality: legality }))).toBe(expected);
  });
});

describe('manaPips', () => {
  it('counts coloured pips', () => {
    expect(manaPips('{G}{W}{U}{B}')).toMatchObject({ W: 1, U: 1, B: 1, G: 1, R: 0, C: 0 });
  });

  it('counts generic mana into the colorless bucket', () => {
    expect(manaPips('{2}{W}')).toMatchObject({ W: 1, C: 2 });
  });

  it('counts true colorless {C}', () => {
    expect(manaPips('{C}{C}')).toMatchObject({ C: 2 });
  });

  it('counts both halves of a hybrid symbol', () => {
    expect(manaPips('{G/W}')).toMatchObject({ G: 1, W: 1, C: 0 });
  });

  it('counts the coloured half of a phyrexian symbol', () => {
    expect(manaPips('{B/P}')).toMatchObject({ B: 1, C: 0 });
  });

  it('counts the coloured half of a monocolour hybrid', () => {
    expect(manaPips('{2/W}')).toMatchObject({ W: 1, C: 0 });
  });

  it('ignores {X} rather than counting it as generic mana', () => {
    expect(manaPips('{X}{R}')).toMatchObject({ R: 1, C: 0 });
  });

  it('returns all zeroes for null or empty costs', () => {
    expect(manaPips(null)).toMatchObject({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });
    expect(manaPips('')).toMatchObject({ C: 0 });
  });
});
