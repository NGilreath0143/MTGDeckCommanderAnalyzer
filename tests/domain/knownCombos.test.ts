import { describe, expect, it } from 'vitest';
import { KNOWN_COMBOS, comboOverlap, detectCombos } from '@/domain/knownCombos';
import type { DeckComposition } from '@/domain/types';
import { realCard } from '../fixtures/roleCards';

const deck = (mainboard: string[], commanders: string[] = []): DeckComposition => ({
  commanders: commanders.map(realCard),
  mainboard: mainboard.map((n) => ({ card: realCard(n), quantity: 1 })),
});

describe('known combo data', () => {
  it('includes the required initial entries', () => {
    const ids = KNOWN_COMBOS.map((c) => c.id);
    expect(ids).toContain('thassas-oracle+demonic-consultation');
    expect(ids).toContain('thassas-oracle+tainted-pact');
    expect(ids).toContain('heliod+walking-ballista');
    expect(ids).toContain('kiki-jiki+zealous-conscripts');
    expect(ids).toContain('exquisite-blood+sanguine-bond');
    expect(ids).toContain('isochron-scepter+dramatic-reversal');
    expect(ids).toContain('underworld-breach+leds+brain-freeze');
    expect(ids).toContain('basalt-monolith+rings-of-brighthearth');
  });

  it('stays small and records a result for every combo', () => {
    expect(KNOWN_COMBOS.length).toBeLessThanOrEqual(12);
    for (const c of KNOWN_COMBOS) {
      expect(c.result).toBeTruthy();
      expect(c.pieces.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('does not store a printed mana value (it is derived)', () => {
    for (const c of KNOWN_COMBOS) {
      expect(c).not.toHaveProperty('printedManaValue');
    }
  });
});

describe('detectCombos', () => {
  it('detects a complete two-card combo', () => {
    const [combo] = detectCombos(deck(["Thassa's Oracle", 'Demonic Consultation']));
    expect(combo?.id).toBe('thassas-oracle+demonic-consultation');
    expect(combo?.comboSize).toBe(2);
    expect(combo?.piecesInMainboard).toBe(2);
    expect(combo?.piecesNeededFromLibrary).toBe(0);
    expect(combo?.result).toBe('immediate_win');
  });

  it('derives printed mana value from the matched cards', () => {
    const [combo] = detectCombos(deck(["Thassa's Oracle", 'Demonic Consultation']));
    // Oracle MV2 + Consultation MV1.
    expect(combo?.totalPrintedManaValue).toBe(3);
  });

  it('preserves Scryfall X semantics (Walking Ballista is MV 0)', () => {
    const [combo] = detectCombos(deck(['Heliod, Sun-Crowned', 'Walking Ballista']));
    const ballista = combo?.pieces.find((p) => p.name === 'Walking Ballista');
    expect(ballista?.printedManaValue).toBe(0);
  });

  it('reports a partial combo with pieces still needed', () => {
    const [combo] = detectCombos(deck(["Thassa's Oracle"]));
    expect(combo?.piecesInMainboard).toBe(1);
    expect(combo?.piecesNeededFromLibrary).toBe(1);
  });

  it('records command-zone pieces separately', () => {
    const combos = detectCombos(deck(['Walking Ballista'], ['Heliod, Sun-Crowned']));
    const combo = combos.find((c) => c.id === 'heliod+walking-ballista');
    expect(combo?.piecesInCommandZone).toBe(1);
    expect(combo?.piecesInMainboard).toBe(1);
    expect(combo?.piecesNeededFromLibrary).toBe(0);
  });

  it('detects nothing when no piece is present', () => {
    expect(detectCombos(deck(['Sol Ring', 'Cultivate']))).toEqual([]);
  });

  it('detects a three-card combo', () => {
    const combos = detectCombos(
      deck(['Underworld Breach', "Lion's Eye Diamond", 'Brain Freeze']),
    );
    const combo = combos.find((c) => c.id === 'underworld-breach+leds+brain-freeze');
    expect(combo?.comboSize).toBe(3);
    expect(combo?.piecesInMainboard).toBe(3);
  });

  it('preserves requirements', () => {
    const [combo] = detectCombos(deck(['Craterhoof Behemoth', "Thassa's Oracle", 'Tainted Pact']));
    expect(combo?.requirements).toContain('library');
  });
});

describe('comboOverlap', () => {
  it('measures the specification example exactly', () => {
    // Oracle + Consultation and Oracle + Tainted Pact: 2 combos, 3 unique
    // pieces, Oracle shared.
    const detected = detectCombos(
      deck(["Thassa's Oracle", 'Demonic Consultation', 'Tainted Pact']),
    );
    const overlap = comboOverlap(detected);
    expect(overlap.detectedCombos).toBe(2);
    expect(overlap.uniqueComboPieces).toBe(3);
    expect(overlap.sharedComboPieces).toBe(1);
  });

  it('reports zeroes for no combos', () => {
    expect(comboOverlap([])).toEqual({
      detectedCombos: 0,
      uniqueComboPieces: 0,
      sharedComboPieces: 0,
    });
  });
});
