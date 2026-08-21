import { describe, expect, it } from 'vitest';
import {
  combinedColorIdentity,
  commanderEligibility,
  identifyCommanders,
  isBackground,
  isCommanderEligible,
  isLegalCommanderPair,
  hasPartner,
} from '@/domain/commander';
import { makeCard } from '../fixtures/cards';

const legend = (over = {}) =>
  makeCard({ typeLine: 'Legendary Creature — Human Wizard', ...over });

describe('commanderEligibility', () => {
  it('accepts a legendary creature', () => {
    expect(commanderEligibility(legend())).toBe('legendary-creature');
  });

  it('accepts a planeswalker that prints the commander clause', () => {
    // 32 real cards print this text (Estrid, Freyalise, Aminatou, ...).
    const estrid = makeCard({
      name: 'Estrid, the Masked',
      typeLine: 'Legendary Planeswalker — Estrid',
      oracleText: 'Estrid, the Masked can be your commander.',
    });
    expect(commanderEligibility(estrid)).toBe('can-be-your-commander');
  });

  it('accepts Grist, which is eligible only by ruling', () => {
    // Verified live: Grist prints NO "can be your commander" clause, so it
    // is matched by the documented exception list instead.
    const grist = makeCard({
      name: 'Grist, the Hunger Tide',
      oracleId: '0efb0d7e-dea0-4817-a243-15066e9ef333',
      typeLine: 'Legendary Planeswalker — Grist',
      oracleText: "As long as Grist isn't on the battlefield, it's a 1/1 Insect creature.",
    });
    expect(commanderEligibility(grist)).toBe('can-be-your-commander');
  });

  it('still rejects an ordinary planeswalker', () => {
    const jace = makeCard({
      name: 'Jace Beleren',
      typeLine: 'Legendary Planeswalker — Jace',
      oracleText: '+1: Each player draws a card.',
    });
    expect(isCommanderEligible(jace)).toBe(false);
  });

  it('rejects a nonlegendary creature', () => {
    // Nazgûl is a plain Creature (verified live).
    expect(isCommanderEligible(makeCard({ typeLine: 'Creature — Wraith Knight' }))).toBe(false);
  });

  it('rejects a legendary noncreature with no enabling text', () => {
    expect(isCommanderEligible(makeCard({ typeLine: 'Legendary Artifact' }))).toBe(false);
  });

  it('accepts a legendary enchantment creature', () => {
    // Faceless One (verified live).
    expect(isCommanderEligible(makeCard({ typeLine: 'Legendary Enchantment Creature — Background' }))).toBe(true);
  });
});

describe('partner and background detection', () => {
  it('reads Partner from the keywords array', () => {
    // Rograkh, Son of Rohgahh has keywords including "Partner" (verified live).
    expect(hasPartner(makeCard({ keywords: ['First strike', 'Partner', 'Trample'] }))).toBe(true);
  });

  it('does not confuse "Partner with" for plain Partner', () => {
    expect(hasPartner(makeCard({ keywords: ['Partner with'] }))).toBe(false);
  });

  it('detects a Background by type line', () => {
    expect(isBackground(makeCard({ typeLine: 'Legendary Enchantment Creature — Background' }))).toBe(true);
  });
});

describe('isLegalCommanderPair', () => {
  it('allows two Partner commanders', () => {
    const a = legend({ keywords: ['Partner'] });
    const b = legend({ keywords: ['Partner'] });
    expect(isLegalCommanderPair(a, b)).toBe(true);
  });

  it('allows a Choose a Background commander with a Background', () => {
    const cmdr = legend({ keywords: ['Choose a Background'] });
    const bg = makeCard({ typeLine: 'Legendary Enchantment Creature — Background' });
    expect(isLegalCommanderPair(cmdr, bg)).toBe(true);
    expect(isLegalCommanderPair(bg, cmdr)).toBe(true);
  });

  it('rejects two unrelated legends', () => {
    expect(isLegalCommanderPair(legend(), legend())).toBe(false);
  });
});

describe('combinedColorIdentity', () => {
  it('unions identities in WUBRG order', () => {
    const a = makeCard({ colorIdentity: ['R'] });
    const b = makeCard({ colorIdentity: ['W', 'B'] });
    expect(combinedColorIdentity([a, b])).toEqual(['W', 'B', 'R']);
  });

  it('is empty for a colorless commander', () => {
    expect(combinedColorIdentity([makeCard({ colorIdentity: [] })])).toEqual([]);
  });
});

describe('identifyCommanders', () => {
  const main = (card: ReturnType<typeof makeCard>) =>
    ({ card, quantity: 1, section: 'main' as const });
  const tagged = (card: ReturnType<typeof makeCard>) =>
    ({ card, quantity: 1, section: 'commander' as const });

  it('prefers the explicitly tagged commander', () => {
    const a = legend({ name: 'A' });
    const b = legend({ name: 'B' });
    const { commanders } = identifyCommanders([main(a), tagged(b)]);
    expect(commanders.map((c) => c.name)).toEqual(['B']);
  });

  it('infers the first eligible legend when nothing is tagged', () => {
    const spell = makeCard({ name: 'Sol Ring', typeLine: 'Artifact' });
    const a = legend({ name: 'A' });
    const b = legend({ name: 'B' });
    const { commanders } = identifyCommanders([main(spell), main(a), main(b)]);
    expect(commanders.map((c) => c.name)).toEqual(['A']);
  });

  it('errors when a tagged card cannot be a commander', () => {
    const { issues } = identifyCommanders([tagged(makeCard({ typeLine: 'Artifact', name: 'Sol Ring' }))]);
    expect(issues.map((i) => i.code)).toContain('INVALID_COMMANDER');
  });

  it('errors when no commander exists at all', () => {
    const { commanders, issues } = identifyCommanders([main(makeCard({ typeLine: 'Artifact' }))]);
    expect(commanders).toEqual([]);
    expect(issues.map((i) => i.code)).toContain('NO_COMMANDER');
  });

  it('accepts a legal partner pair', () => {
    const a = legend({ name: 'A', keywords: ['Partner'] });
    const b = legend({ name: 'B', keywords: ['Partner'] });
    const { commanders, issues } = identifyCommanders([tagged(a), tagged(b)]);
    expect(commanders).toHaveLength(2);
    expect(issues).toEqual([]);
  });

  it('rejects two tagged legends that cannot pair', () => {
    const { issues } = identifyCommanders([tagged(legend({ name: 'A' })), tagged(legend({ name: 'B' }))]);
    expect(issues.map((i) => i.code)).toContain('TOO_MANY_COMMANDERS');
  });

  it('rejects three tagged commanders', () => {
    const p = (n: string) => tagged(legend({ name: n, keywords: ['Partner'] }));
    const { issues } = identifyCommanders([p('A'), p('B'), p('C')]);
    expect(issues.map((i) => i.code)).toContain('TOO_MANY_COMMANDERS');
  });
});
