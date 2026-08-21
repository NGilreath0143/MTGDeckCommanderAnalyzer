import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { mapScryfallCard } from '@/infra/scryfall/mapScryfallCard';
import type { ScryfallCard, ScryfallCollectionResponse } from '@/infra/scryfall/types';

/**
 * Runs against a real captured /cards/collection response, so the API facts
 * this design depends on are pinned as regression tests.
 */
const response = JSON.parse(
  readFileSync('tests/fixtures/scryfall/collection-mixed.json', 'utf8'),
) as ScryfallCollectionResponse;

const byName = (name: string): ScryfallCard => {
  const card = response.data.find((c) => c.name === name);
  if (!card) throw new Error(`fixture missing card: ${name}`);
  return card;
};

describe('the captured fixture itself', () => {
  it('echoes unmatched identifiers back as identifier objects, not names', () => {
    // This is why the pipeline maps not_found back by identifier.
    expect(response.not_found).toEqual([{ name: 'Definitely Not A Real Card 9999' }]);
  });

  it('canonicalises the names we deliberately mistyped', () => {
    // Sent "Atraxa, Praetors Voice" and "Nazgul".
    expect(response.data.map((c) => c.name)).toContain("Atraxa, Praetors' Voice");
    expect(response.data.map((c) => c.name)).toContain('Nazgûl');
  });
});

describe('mapScryfallCard', () => {
  it('maps a simple card', () => {
    const card = mapScryfallCard(byName('Sol Ring'));
    expect(card).toMatchObject({
      name: 'Sol Ring',
      normalizedName: 'sol ring',
      cmc: 1,
      typeLine: 'Artifact',
      colorIdentity: [],
      commanderLegality: 'legal',
    });
  });

  it('keeps the top-level cmc and joined type line of a modal DFC', () => {
    const card = mapScryfallCard(byName('Malakir Rebirth // Malakir Mire'));
    // The faces carry no cmc; the top level does.
    expect(card.cmc).toBe(1);
    expect(card.typeLine).toBe('Instant // Land');
    expect(card.colorIdentity).toEqual(['B']);
  });

  it('records Grist as a planeswalker that prints no commander clause', () => {
    // Grist is commander-legal by rules-committee ruling, NOT by card text:
    // its oracle text carries no "can be your commander" clause. Confirmed
    // against the live API, which is why commander.ts needs an exception list.
    const card = mapScryfallCard(byName('Grist, the Hunger Tide'));
    expect(card.typeLine).toContain('Legendary Planeswalker');
    expect(card.oracleText).not.toMatch(/can be your commander/i);
    expect(card.oracleId).toBe('0efb0d7e-dea0-4817-a243-15066e9ef333');
  });

  it('captures the Partner keyword', () => {
    expect(mapScryfallCard(byName('Rograkh, Son of Rohgahh')).keywords).toContain('Partner');
  });

  it('records a banned card as banned', () => {
    expect(mapScryfallCard(byName('Black Lotus')).commanderLegality).toBe('banned');
  });

  it('normalises an accented name to an ASCII lookup key', () => {
    const card = mapScryfallCard(byName('Nazgûl'));
    expect(card.name).toBe('Nazgûl');
    expect(card.normalizedName).toBe('nazgul');
  });

  it('preserves basic land type lines', () => {
    expect(mapScryfallCard(byName('Snow-Covered Forest')).typeLine).toBe('Basic Snow Land — Forest');
    expect(mapScryfallCard(byName('Wastes')).typeLine).toBe('Basic Land');
  });

  it('stores the full raw payload', () => {
    const raw = byName('Cultivate');
    expect(mapScryfallCard(raw).scryfallJson).toBe(raw);
  });

  it('maps every card in the fixture without throwing', () => {
    const mapped = response.data.map(mapScryfallCard);
    expect(mapped).toHaveLength(15);
    expect(mapped.every((c) => c.scryfallId && c.oracleId && c.name)).toBe(true);
    expect(mapped.every((c) => typeof c.cmc === 'number')).toBe(true);
  });

  it('defaults an unknown legality to not_legal', () => {
    const fake = { id: 'x', name: 'X', legalities: { commander: 'weird' } } as ScryfallCard;
    expect(mapScryfallCard(fake).commanderLegality).toBe('not_legal');
  });

  it('falls back to face data when the top level omits it', () => {
    const faced = {
      id: 'y',
      name: 'Front // Back',
      card_faces: [
        { name: 'Front', mana_cost: '{1}{R}', type_line: 'Creature — Human', oracle_text: 'Front text' },
        { name: 'Back', mana_cost: '', type_line: 'Land', oracle_text: 'Back text' },
      ],
    } as ScryfallCard;
    const card = mapScryfallCard(faced);
    expect(card.manaCost).toBe('{1}{R}');
    expect(card.typeLine).toBe('Creature — Human // Land');
    expect(card.oracleText).toBe('Front text\n//\nBack text');
  });
});
