import { describe, expect, it } from 'vitest';
import {
  frontFaceName,
  nameLookupKeys,
  normalizeCardName,
} from '@/domain/normalizeName';

describe('normalizeCardName', () => {
  it('folds diacritics so user spelling matches Scryfall canonical', () => {
    // Verified live: Scryfall returns "Nazgûl" for a "Nazgul" query.
    expect(normalizeCardName('Nazgûl')).toBe(normalizeCardName('Nazgul'));
    expect(normalizeCardName('Lim-Dûl the Necromancer')).toBe(
      normalizeCardName('Lim-Dul the Necromancer'),
    );
    expect(normalizeCardName('Márton Stromgald')).toBe(
      normalizeCardName('Marton Stromgald'),
    );
  });

  it('drops apostrophes and commas', () => {
    expect(normalizeCardName("Urza's Saga")).toBe('urzas saga');
    expect(normalizeCardName("Atraxa, Praetors' Voice")).toBe(
      'atraxa praetors voice',
    );
  });

  it('is case- and whitespace-insensitive', () => {
    expect(normalizeCardName('  SOL   Ring ')).toBe('sol ring');
  });

  it('treats hyphens as separators, matching the spaced spelling', () => {
    expect(normalizeCardName('Snow-Covered Forest')).toBe('snow covered forest');
  });

  it('does not merge distinct words into one token', () => {
    expect(normalizeCardName('A B')).not.toBe(normalizeCardName('AB'));
  });

  it('maps the ae ligature', () => {
    expect(normalizeCardName('Æther Vial')).toBe(normalizeCardName('Aether Vial'));
  });
});

describe('frontFaceName', () => {
  it('takes the front face of a DFC name', () => {
    expect(frontFaceName('Malakir Rebirth // Malakir Mire')).toBe('Malakir Rebirth');
  });

  it('splits a single-slash separator, which some exporters emit', () => {
    // Verified live: /cards/collection returns not_found for BOTH slash forms;
    // only the bare front face resolves.
    expect(frontFaceName('Sejiri Shelter / Sejiri Glacier')).toBe('Sejiri Shelter');
    expect(frontFaceName('Brightclimb Pathway / Grimclimb Pathway')).toBe('Brightclimb Pathway');
  });

  it('leaves a slash with no surrounding whitespace alone', () => {
    expect(frontFaceName('Question Mark/Ampersand')).toBe('Question Mark/Ampersand');
  });

  it('leaves single-faced names alone', () => {
    expect(frontFaceName('Sol Ring')).toBe('Sol Ring');
  });
});

describe('nameLookupKeys', () => {
  it('offers both the full name and the front face for DFCs', () => {
    expect(nameLookupKeys('Malakir Rebirth // Malakir Mire')).toEqual([
      'malakir rebirth malakir mire',
      'malakir rebirth',
    ]);
  });

  it('returns a single key for single-faced cards', () => {
    expect(nameLookupKeys('Sol Ring')).toEqual(['sol ring']);
  });
});
