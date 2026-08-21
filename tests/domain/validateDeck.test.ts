import { describe, expect, it } from 'vitest';
import {
  validateColorIdentity,
  validateDeck,
  validateDeckSize,
  validateLegality,
  validateSingleton,
} from '@/domain/validateDeck';
import type { DeckComposition } from '@/domain/types';
import { basicLand, makeCard, makeValidDeck } from '../fixtures/cards';

const codes = (c: DeckComposition) => validateDeck(c).issues.map((i) => i.code);

describe('validateDeckSize', () => {
  it('accepts exactly 100 cards including the commander', () => {
    const deck = makeValidDeck();
    expect(validateDeckSize(deck)).toEqual([]);
    expect(validateDeck(deck).valid).toBe(true);
  });

  it('rejects 99 cards', () => {
    const deck = makeValidDeck();
    deck.mainboard.pop();
    const issues = validateDeckSize(deck);
    expect(issues[0]).toMatchObject({ code: 'DECK_SIZE', details: { actual: 99 } });
  });

  it('rejects 101 cards', () => {
    const deck = makeValidDeck();
    deck.mainboard.push({ card: makeCard({ colorIdentity: [] }), quantity: 1 });
    expect(validateDeckSize(deck)[0]).toMatchObject({ details: { actual: 101 } });
  });
});

describe('validateSingleton', () => {
  it('allows many copies of a basic land', () => {
    // 37 Plains in the valid deck.
    expect(validateSingleton(makeValidDeck())).toEqual([]);
  });

  it('flags a duplicated nonbasic card', () => {
    const deck = makeValidDeck();
    const solRing = makeCard({ name: 'Sol Ring', oracleId: 'sol-ring' });
    deck.mainboard.push({ card: solRing, quantity: 2 });
    const issues = validateSingleton(deck);
    expect(issues[0]?.code).toBe('SINGLETON');
    expect(issues[0]?.cardNames).toEqual(['Sol Ring']);
  });

  it('flags the same card listed on two separate lines', () => {
    const deck = makeValidDeck();
    const a = makeCard({ name: 'Sol Ring', oracleId: 'sol-ring' });
    const b = makeCard({ name: 'Sol Ring', oracleId: 'sol-ring' });
    deck.mainboard.push({ card: a, quantity: 1 }, { card: b, quantity: 1 });
    expect(validateSingleton(deck)[0]?.code).toBe('SINGLETON');
  });

  it('allows a nonbasic land only once', () => {
    const deck = makeValidDeck();
    deck.mainboard.push({
      card: makeCard({ name: 'Command Tower', typeLine: 'Land', oracleId: 'ct' }),
      quantity: 2,
    });
    expect(validateSingleton(deck)[0]?.code).toBe('SINGLETON');
  });
});

describe('validateColorIdentity', () => {
  it('accepts cards inside the identity', () => {
    expect(validateColorIdentity(makeValidDeck())).toEqual([]);
  });

  it('rejects a card outside the identity', () => {
    const deck = makeValidDeck();
    deck.mainboard.push({
      card: makeCard({ name: 'Lightning Bolt', colorIdentity: ['R'] }),
      quantity: 1,
    });
    const issues = validateColorIdentity(deck);
    expect(issues[0]).toMatchObject({ code: 'COLOR_IDENTITY', cardNames: ['Lightning Bolt'] });
  });

  it('accepts colorless cards in any deck', () => {
    const deck = makeValidDeck();
    deck.mainboard.push({ card: makeCard({ name: 'Sol Ring', colorIdentity: [] }), quantity: 1 });
    expect(validateColorIdentity(deck)).toEqual([]);
  });

  it('uses the union of two commanders identities', () => {
    const deck = makeValidDeck();
    deck.commanders.push(makeCard({ name: 'Partner B', colorIdentity: ['R'] }));
    deck.mainboard.push({ card: makeCard({ colorIdentity: ['R'] }), quantity: 1 });
    expect(validateColorIdentity(deck)).toEqual([]);
  });

  it('skips the check when there is no commander', () => {
    const deck = makeValidDeck();
    deck.commanders = [];
    expect(validateColorIdentity(deck)).toEqual([]);
  });
});

describe('validateLegality', () => {
  it('flags a banned card', () => {
    const deck = makeValidDeck();
    deck.mainboard.push({
      card: makeCard({ name: 'Black Lotus', commanderLegality: 'banned' }),
      quantity: 1,
    });
    const issues = validateLegality(deck);
    expect(issues[0]).toMatchObject({ code: 'BANNED', cardNames: ['Black Lotus'] });
  });

  it('flags a not_legal card separately', () => {
    const deck = makeValidDeck();
    deck.mainboard.push({
      card: makeCard({ name: 'Some Playtest Card', commanderLegality: 'not_legal' }),
      quantity: 1,
    });
    expect(validateLegality(deck)[0]?.code).toBe('NOT_LEGAL');
  });

  it('checks the commander too', () => {
    const deck = makeValidDeck();
    deck.commanders = [makeCard({ name: 'Bad Cmdr', commanderLegality: 'banned' })];
    expect(validateLegality(deck)[0]?.cardNames).toEqual(['Bad Cmdr']);
  });
});

describe('validateDeck', () => {
  it('is valid for a well-formed deck', () => {
    const result = validateDeck(makeValidDeck());
    expect(result).toMatchObject({ valid: true, issues: [] });
  });

  it('accumulates several problems at once', () => {
    const deck = makeValidDeck();
    deck.mainboard.push(
      { card: makeCard({ name: 'Lightning Bolt', colorIdentity: ['R'] }), quantity: 1 },
      { card: makeCard({ name: 'Black Lotus', commanderLegality: 'banned' }), quantity: 1 },
    );
    const found = codes(deck);
    expect(found).toContain('DECK_SIZE');
    expect(found).toContain('COLOR_IDENTITY');
    expect(found).toContain('BANNED');
  });

  it('carries prior issues into the verdict', () => {
    const result = validateDeck(makeValidDeck(), [
      { code: 'NO_COMMANDER', severity: 'error', message: 'none' },
    ]);
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.code).toBe('NO_COMMANDER');
  });

  it('stays valid when a prior issue is only a warning', () => {
    const result = validateDeck(makeValidDeck(), [
      { code: 'UNRESOLVED_CARDS', severity: 'warning', message: 'hm' },
    ]);
    expect(result.valid).toBe(true);
  });

  it('exempts a deck of 37 basics from singleton but still counts them', () => {
    const deck = makeValidDeck();
    expect(codes(deck)).toEqual([]);
    expect(deck.mainboard[0]?.quantity).toBe(37);
    expect(basicLand('Plains', 'W').typeLine).toContain('Basic');
  });
});
