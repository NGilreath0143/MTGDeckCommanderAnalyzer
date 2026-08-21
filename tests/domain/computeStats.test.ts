import { describe, expect, it } from 'vitest';
import {
  computeAverageManaValue,
  computeColorDistribution,
  computeManaCurve,
  computeStats,
  computeTypeDistribution,
} from '@/domain/computeStats';
import { basicLand, makeCard, makeValidDeck } from '../fixtures/cards';

const entry = (card: ReturnType<typeof makeCard>, quantity = 1) => ({ card, quantity });

describe('computeManaCurve', () => {
  it('buckets by mana value and collapses 7 and above', () => {
    const curve = computeManaCurve([
      entry(makeCard({ cmc: 0, typeLine: 'Artifact' })),
      entry(makeCard({ cmc: 3, typeLine: 'Sorcery' })),
      entry(makeCard({ cmc: 7, typeLine: 'Creature — Giant' })),
      entry(makeCard({ cmc: 12, typeLine: 'Creature — Eldrazi' })),
    ]);
    expect(curve['0']).toBe(1);
    expect(curve['3']).toBe(1);
    expect(curve['7+']).toBe(2);
  });

  it('excludes lands from the curve', () => {
    const curve = computeManaCurve([entry(basicLand('Forest', 'G'), 37)]);
    expect(Object.values(curve).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('respects quantity', () => {
    expect(computeManaCurve([entry(makeCard({ cmc: 2, typeLine: 'Instant' }), 4)])['2']).toBe(4);
  });

  it('uses the top-level cmc of a modal DFC', () => {
    // Verified live: Malakir Rebirth // Malakir Mire has cmc 1 and
    // type_line "Instant // Land" -> a nonland card in the 1 bucket.
    const curve = computeManaCurve([
      entry(makeCard({ typeLine: 'Instant // Land', cmc: 1, manaCost: '{B}' })),
    ]);
    expect(curve['1']).toBe(1);
  });

  it('has every bucket present even when empty', () => {
    const curve = computeManaCurve([]);
    expect(Object.keys(curve)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7+']);
  });
});

describe('computeAverageManaValue', () => {
  it('averages nonland cards only', () => {
    const avg = computeAverageManaValue([
      entry(makeCard({ cmc: 2, typeLine: 'Instant' })),
      entry(makeCard({ cmc: 4, typeLine: 'Creature — Bear' })),
      entry(basicLand('Forest', 'G'), 37),
    ]);
    expect(avg).toBe(3);
  });

  it('weights by quantity', () => {
    const avg = computeAverageManaValue([
      entry(makeCard({ cmc: 1, typeLine: 'Instant' }), 3),
      entry(makeCard({ cmc: 5, typeLine: 'Instant' }), 1),
    ]);
    expect(avg).toBe(2);
  });

  it('returns 0 for an all-land list rather than dividing by zero', () => {
    expect(computeAverageManaValue([entry(basicLand('Forest', 'G'), 5)])).toBe(0);
  });

  it('rounds to two decimals', () => {
    const avg = computeAverageManaValue([
      entry(makeCard({ cmc: 1, typeLine: 'Instant' })),
      entry(makeCard({ cmc: 2, typeLine: 'Instant' })),
      entry(makeCard({ cmc: 2, typeLine: 'Instant' })),
    ]);
    expect(avg).toBe(1.67);
  });
});

describe('computeTypeDistribution', () => {
  it('counts each card exactly once', () => {
    const dist = computeTypeDistribution([
      entry(makeCard({ typeLine: 'Artifact Creature — Golem' })),
      entry(makeCard({ typeLine: 'Land Creature — Forest Dryad' })),
      entry(makeCard({ typeLine: 'Instant' })),
      entry(basicLand('Forest', 'G'), 10),
    ]);
    expect(dist.Creature).toBe(1);
    expect(dist.Land).toBe(11);
    expect(dist.Instant).toBe(1);
    expect(dist.Artifact).toBe(0);
  });

  it('sums to the deck size', () => {
    const deck = makeValidDeck();
    const all = [...deck.commanders.map((c) => entry(c)), ...deck.mainboard];
    const dist = computeTypeDistribution(all);
    expect(Object.values(dist).reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe('computeColorDistribution', () => {
  it('counts pips across the deck weighted by quantity', () => {
    const dist = computeColorDistribution([
      entry(makeCard({ manaCost: '{G}{W}' })),
      entry(makeCard({ manaCost: '{1}{G}' }), 2),
    ]);
    expect(dist.G).toBe(3);
    expect(dist.W).toBe(1);
    expect(dist.C).toBe(2);
  });
});

describe('computeStats', () => {
  it('profiles a valid 100-card deck coherently', () => {
    const stats = computeStats(makeValidDeck());
    expect(stats.totalCards).toBe(100);
    expect(stats.landCount).toBe(37);
    expect(stats.nonlandCount).toBe(63);
    // 62 mainboard spells at cmc 2; the commander is excluded from the average.
    expect(stats.averageManaValue).toBe(2);
    expect(stats.typeDistribution.Land).toBe(37);
    expect(stats.typeDistribution.Creature).toBe(1);
    expect(stats.typeDistribution.Instant).toBe(62);
    // Curve covers the 62 mainboard nonlands, not the commander.
    expect(stats.manaCurve['2']).toBe(62);
    expect(Object.values(stats.manaCurve).reduce((a, b) => a + b, 0)).toBe(62);
  });

  it('includes the commander in counts and identity distribution', () => {
    const stats = computeStats(makeValidDeck());
    // 37 Plains + 62 white spells + a WU commander.
    expect(stats.colorIdentityDistribution.W).toBe(100);
    expect(stats.colorIdentityDistribution.U).toBe(1);
  });
});
