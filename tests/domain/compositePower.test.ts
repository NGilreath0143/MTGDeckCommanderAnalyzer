import { describe, expect, it } from 'vitest';
import {
  aggregateDimensions,
  assessCompositePower,
  geometricMean,
  type CompositeDimensionScores,
  type DimensionName,
} from '@/domain/compositePower';
import { analyzeDeckStrategy } from '@/domain/strategy';
import { inferDeckArchetypes } from '@/domain/archetypes';
import { extractDeckPowerEvidence } from '@/domain/powerEvidence';
import type { DeckComposition } from '@/domain/types';
import { basicLand, makeCard } from '../fixtures/cards';
import { realCard } from '../fixtures/roleCards';

const vec = (s: number, c: number, i: number, r: number): CompositeDimensionScores => ({
  speed: s, consistency: c, interaction: i, resilience: r,
});
const agg = (s: number, c: number, i: number, r: number) => aggregateDimensions(vec(s, c, i, r)).score;
const arith = (s: number, c: number, i: number, r: number) => (s + c + i + r) / 4;

describe('composite index: geometric mean', () => {
  it('returns the common value when all four are equal', () => {
    expect(agg(60, 60, 60, 60)).toBe(60);
    expect(agg(75, 75, 75, 75)).toBe(75);
  });

  it('is zero when any dimension is zero, with no epsilon softening', () => {
    /*
     * A dimension the deck genuinely cannot do at all is a catastrophic
     * weakness and must stay visible as one.
     */
    expect(agg(0, 90, 90, 90)).toBe(0);
    expect(agg(90, 0, 90, 90)).toBe(0);
    expect(agg(90, 90, 0, 90)).toBe(0);
    expect(agg(90, 90, 90, 0)).toBe(0);
    expect(agg(0, 0, 0, 0)).toBe(0);
  });

  it('penalises one catastrophic dimension below a balanced-medium deck', () => {
    // The decisive case: arithmetic would rank 80/80/80/10 (62.5) ABOVE 60/60/60/60.
    expect(agg(80, 80, 80, 10)).toBeLessThan(agg(60, 60, 60, 60));
    expect(arith(80, 80, 80, 10)).toBeGreaterThan(arith(60, 60, 60, 60));
  });

  it('scores an unbalanced vector below its own arithmetic mean', () => {
    expect(agg(90, 70, 30, 30)).toBeLessThan(arith(90, 70, 30, 30));
    expect(agg(80, 80, 80, 10)).toBeLessThan(arith(80, 80, 80, 10));
    expect(agg(95, 50, 50, 50)).toBeLessThan(arith(95, 50, 50, 50));
  });

  it('equals the arithmetic mean only when perfectly balanced', () => {
    /*
     * Asserted on the unrounded mean: at 60/60/60/61 the two differ by 0.0015,
     * which is below the 2-decimal resolution of the emitted score.
     */
    expect(agg(60, 60, 60, 60)).toBeCloseTo(arith(60, 60, 60, 60), 6);
    expect(geometricMean([60, 60, 60, 61])).toBeLessThan(arith(60, 60, 60, 61));
    expect(geometricMean([60, 60, 60, 80])).toBeLessThan(arith(60, 60, 60, 80));
  });

  it('is permutation invariant', () => {
    const base = agg(90, 70, 30, 40);
    for (const p of [
      [70, 90, 40, 30], [30, 40, 90, 70], [40, 30, 70, 90], [30, 90, 70, 40],
    ] as const) {
      expect(agg(p[0], p[1], p[2], p[3])).toBeCloseTo(base, 6);
    }
  });

  it('never decreases when a single dimension increases', () => {
    const dims: DimensionName[] = ['speed', 'consistency', 'interaction', 'resilience'];
    for (const d of dims) {
      let previous = -1;
      for (const value of [5, 20, 40, 60, 80, 100]) {
        const v = { ...vec(50, 50, 50, 50), [d]: value } as CompositeDimensionScores;
        const score = aggregateDimensions(v).score;
        expect(score, `${d}=${value}`).toBeGreaterThanOrEqual(previous);
        previous = score;
      }
    }
  });

  it('handles an empty input without throwing', () => {
    expect(geometricMean([])).toBe(0);
  });
});

describe('shape', () => {
  it('bounds the score and echoes the four dimensions', () => {
    const a = aggregateDimensions(vec(53.61, 68.93, 62.41, 40.33));
    expect(a.score).toBeGreaterThan(0);
    expect(a.score).toBeLessThanOrEqual(100);
    expect(a.dimensions).toEqual({
      speed: 53.61, consistency: 68.93, interaction: 62.41, resilience: 40.33,
    });
  });

  it('clamps out-of-range inputs defensively without otherwise transforming them', () => {
    const a = aggregateDimensions(vec(-10, 150, 50, 50));
    expect(a.dimensions.speed).toBe(0);
    expect(a.dimensions.consistency).toBe(100);
    expect(a.score).toBe(0); // clamped speed is a true zero
  });

  it('identifies the minimum dimension and its score', () => {
    const a = aggregateDimensions(vec(53.61, 68.93, 62.41, 40.33));
    expect(a.diagnostics.minimumDimension).toBe('resilience');
    expect(a.diagnostics.minimumScore).toBe(40.33);
  });

  it('reports the arithmetic mean for comparison but never as the score', () => {
    const a = aggregateDimensions(vec(80, 80, 80, 10));
    expect(a.diagnostics.arithmeticMean).toBe(62.5);
    expect(a.score).toBeLessThan(a.diagnostics.arithmeticMean);
  });

  it('emits no overall rating, band, or Commander power-level field', () => {
    /*
     * Checks the keys, not the whole payload: `limitations` deliberately
     * mentions bands and power levels to say they are absent.
     */
    const a = aggregateDimensions(vec(60, 60, 60, 60));
    const keys = [
      ...Object.keys(a),
      ...Object.keys(a.dimensions),
      ...Object.keys(a.diagnostics),
    ];
    for (const k of keys) {
      expect(k, k).not.toMatch(/rating|band|tier|powerLevel|cedh/i);
    }
    expect(keys).toEqual(expect.arrayContaining(['score', 'dimensions', 'diagnostics']));
    // Individual-dimension bands must NOT be reused for the composite.
    for (const band of ['low', 'moderate', 'good', 'high', 'elite']) {
      expect(keys).not.toContain(band);
    }
  });

  it('always echoes the four-dimensional profile beside the index', () => {
    // The profile is primary; the index must never stand alone.
    const a = aggregateDimensions(vec(48.01, 65.19, 77.57, 60.31));
    expect(Object.keys(a.dimensions).sort())
      .toEqual(['consistency', 'interaction', 'resilience', 'speed']);
  });
});

describe('limitations', () => {
  it('always discloses the calibration limits', () => {
    const l = aggregateDimensions(vec(60, 60, 60, 60)).limitations.join(' ');
    expect(l).toMatch(/UNCALIBRATED composite index/);
    expect(l).toMatch(/chosen semantically, not\s+statistically calibrated/);
    expect(l).toMatch(/n=9/);
    expect(l).toMatch(/no matchup-specific modelling/);
    expect(l).toMatch(/deliberately do NOT alter the/);
  });

  it('discloses the cross-dimension scale mismatch specifically', () => {
    /*
     * The commensurability audit finding: Speed's non-combo ceiling is about
     * 69 while the others reach ~100, so equal numbers are not equal positions.
     * This must be stated, not hidden behind a rescaling.
     */
    const l = aggregateDimensions(vec(60, 60, 60, 60)).limitations.join(' ');
    expect(l).toMatch(/not fully ratio-comparable/);
    expect(l).toMatch(/about 69/);
    expect(l).toMatch(/under-weights\s+Speed/);
  });

  it('discloses that rankings are indicative rather than settled', () => {
    const l = aggregateDimensions(vec(60, 60, 60, 60)).limitations.join(' ');
    expect(l).toMatch(/indicative rather than settled/);
    expect(l).toMatch(/1\.5 composite points/);
  });

  it('states that the four-dimensional profile is primary', () => {
    const l = aggregateDimensions(vec(60, 60, 60, 60)).limitations.join(' ');
    expect(l).toMatch(/profile is the primary interpretation/);
  });
});

describe('deck integration', () => {
  const filler = (n: number) => ({
    card: makeCard({ name: 'Filler', typeLine: 'Creature — Human', cmc: 3, manaCost: '{2}{G}', oracleText: '' }),
    quantity: n,
  });
  const land = (n: number) => ({ card: basicLand('Forest', 'G'), quantity: n });

  const assess = (composition: DeckComposition) => {
    const strategy = analyzeDeckStrategy(composition);
    const archetypes = inferDeckArchetypes(composition, strategy);
    const evidence = extractDeckPowerEvidence(composition, strategy, archetypes);
    return assessCompositePower(composition, evidence, archetypes);
  };

  it('aggregates a real deck composition end to end', () => {
    const a = assess({
      commanders: [realCard('Talrand, Sky Summoner')],
      mainboard: [
        { card: realCard('Counterspell'), quantity: 1 },
        { card: realCard('Swords to Plowshares'), quantity: 1 },
        { card: realCard('Rhystic Study'), quantity: 1 },
        filler(59), land(37),
      ],
    });
    for (const d of ['speed', 'consistency', 'interaction', 'resilience'] as const) {
      expect(a.dimensions[d], d).toBeGreaterThanOrEqual(0);
      expect(a.dimensions[d], d).toBeLessThanOrEqual(100);
    }
    expect(a.score).toBeGreaterThanOrEqual(0);
  });

  it('returns zero overall when a deck genuinely lacks a dimension', () => {
    // A pile of vanilla creatures interacts with nothing.
    const a = assess({ commanders: [], mainboard: [filler(62), land(37)] });
    expect(a.dimensions.interaction).toBe(0);
    expect(a.score).toBe(0);
    expect(a.diagnostics.minimumScore).toBe(0);
  });
});
