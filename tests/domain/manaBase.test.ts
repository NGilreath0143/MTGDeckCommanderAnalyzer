import { describe, expect, it } from 'vitest';
import { extractManaBaseFacts, isFetchLand, landTappedState } from '@/domain/manaBase';
import type { DeckComposition, ResolvedCard } from '@/domain/types';
import { basicLand, makeCard } from '../fixtures/cards';
import { realCard } from '../fixtures/roleCards';

const land = (name: string, oracleText: string, produced?: ResolvedCard['producedMana']) =>
  makeCard({ name, typeLine: 'Land', oracleText, manaCost: '', cmc: 0, ...(produced ? { producedMana: produced } : {}) });

const deck = (entries: { card: ResolvedCard; quantity: number }[]): DeckComposition => ({
  commanders: [],
  mainboard: entries,
});

describe('tapped-state classification', () => {
  it('classifies an unconditional tapped land', () => {
    expect(landTappedState(land('Tapped', 'This land enters tapped.\n{T}: Add {B}.'))).toBe('tapped');
  });

  it('classifies a conditional land', () => {
    expect(
      landTappedState(
        land('Checkland', 'This land enters tapped unless you control a Plains or an Island.'),
      ),
    ).toBe('conditional');
  });

  it('classifies a shockland as conditional', () => {
    expect(
      landTappedState(
        land('Shock', 'As this land enters, you may pay 2 life. If you don\'t, it enters tapped.'),
      ),
    ).toBe('conditional');
  });

  it('classifies a plain land as untapped', () => {
    expect(landTappedState(land('Plain', '{T}: Add {G}.'))).toBe('untapped');
    expect(landTappedState(basicLand('Forest', 'G'))).toBe('untapped');
  });
});

describe('fetchlands', () => {
  it('identifies a fetchland', () => {
    expect(isFetchLand(realCard('Windswept Heath'))).toBe(true);
  });

  it('does not treat an ordinary land as a fetchland', () => {
    expect(isFetchLand(basicLand('Forest', 'G'))).toBe(false);
  });

  it('resolves fetchable count against actual deck contents', () => {
    // Windswept Heath fetches Forest or Plains types.
    const withTargets = extractManaBaseFacts(
      deck([
        { card: realCard('Windswept Heath'), quantity: 1 },
        { card: basicLand('Forest', 'G'), quantity: 5 },
        { card: basicLand('Plains', 'W'), quantity: 4 },
      ]),
    );
    expect(withTargets.fetchLandCount).toBe(1);
    expect(withTargets.fetchableLandCount).toBe(9);

    // No fetchable targets in the deck at all.
    const withoutTargets = extractManaBaseFacts(
      deck([
        { card: realCard('Windswept Heath'), quantity: 1 },
        { card: basicLand('Island', 'U'), quantity: 5 },
      ]),
    );
    expect(withoutTargets.fetchLandCount).toBe(1);
    expect(withoutTargets.fetchableLandCount).toBe(0);
  });
});

describe('color sources come from produced mana, not oracle text', () => {
  it('counts a dual land as two sources', () => {
    const facts = extractManaBaseFacts(
      deck([{ card: land('Dual', '({T}: Add {G} or {W}.)', ['G', 'W']), quantity: 4 }]),
    );
    expect(facts.greenSources).toBe(4);
    expect(facts.whiteSources).toBe(4);
    expect(facts.multiColorSources).toBe(4);
  });

  it('counts an any-color land as five sources', () => {
    const anyColor = land(
      'Any Color Land',
      "{T}: Add one mana of any color in your commander's color identity.",
      ['W', 'U', 'B', 'R', 'G'],
    );
    const facts = extractManaBaseFacts(deck([{ card: anyColor, quantity: 2 }]));
    expect(facts.anyColorSources).toBe(2);
    expect(facts.whiteSources).toBe(2);
    expect(facts.greenSources).toBe(2);
    expect(facts.multiColorSources).toBe(0);
  });

  it('reports no colored sources when producedMana is absent', () => {
    // Hand-built fixtures carry no producedMana; the facts must stay coherent
    // rather than guessing colors from text.
    const facts = extractManaBaseFacts(
      deck([{ card: land('Unknown', '{T}: Add {G}.'), quantity: 3 }]),
    );
    expect(facts.landCount).toBe(3);
    expect(facts.greenSources).toBe(0);
  });

  it('distinguishes colorless-only lands', () => {
    const facts = extractManaBaseFacts(
      deck([{ card: land('Colorless', '{T}: Add {C}.', []), quantity: 3 }]),
    );
    expect(facts.colorlessOnlyLandCount).toBe(3);
    expect(facts.colorlessSources).toBe(3);
  });
});

describe('MDFCs remain distinguishable', () => {
  it('counts an MDFC land separately from ordinary lands', () => {
    const mdfc = makeCard({
      name: 'Spell // Land',
      typeLine: 'Instant // Land',
      oracleText: 'Do a thing.\n//\nThis land enters tapped.\n{T}: Add {B}.',
      cmc: 1,
    });
    const facts = extractManaBaseFacts(
      deck([
        { card: mdfc, quantity: 1 },
        { card: basicLand('Swamp', 'B'), quantity: 10 },
      ]),
    );
    expect(facts.landCount).toBe(10);
    expect(facts.mdfcLandCount).toBe(1);
  });
});

describe('curve and color demand', () => {
  it('counts pips from nonland cards only', () => {
    const facts = extractManaBaseFacts(
      deck([
        { card: makeCard({ name: 'Spell', typeLine: 'Instant', manaCost: '{U}{U}', cmc: 2 }), quantity: 2 },
        { card: basicLand('Island', 'U'), quantity: 5 },
      ]),
    );
    expect(facts.bluePips).toBe(4);
  });

  it('flags demanding early costs such as UU at MV2', () => {
    const facts = extractManaBaseFacts(
      deck([
        { card: makeCard({ name: 'Counterspell', typeLine: 'Instant', manaCost: '{U}{U}', cmc: 2 }), quantity: 1 },
      ]),
    );
    expect(facts.demandingEarlyCosts).toContain('UU at MV2');
  });

  it('reports land percentage against actual deck size', () => {
    const facts = extractManaBaseFacts(
      deck([
        { card: basicLand('Forest', 'G'), quantity: 30 },
        { card: makeCard({ name: 'Spell', typeLine: 'Instant' }), quantity: 70 },
      ]),
    );
    expect(facts.landCount).toBe(30);
    expect(facts.landPercentage).toBeCloseTo(0.3, 2);
  });

  it('handles an empty deck without dividing by zero', () => {
    const facts = extractManaBaseFacts(deck([]));
    expect(facts.landCount).toBe(0);
    expect(facts.landPercentage).toBe(0);
  });
});
