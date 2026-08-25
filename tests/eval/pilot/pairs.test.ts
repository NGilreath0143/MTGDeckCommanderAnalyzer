import { describe, expect, it } from 'vitest';
import {
  allPairs, buildRaterBundle, pilotPairs, PILOT_DEGREE, samplePairs,
} from '@/eval/pilot/pairs';
import { renderRaterBundle, type DeckForBundle } from '@/eval/pilot/bundle';
import { checkPilotCoverage, PILOT_DECK_COUNT } from '@/eval/pilot/corpus';
import type { DeckMeta } from '@/eval/pilot/types';

const ids = (n: number) =>
  Array.from({ length: n }, (_, i) => `deck-${(i + 0xa000).toString(16)}`);

describe('pilot pair set', () => {
  const twelve = ids(12);

  it('is exactly 24 pairs, not the complete graph', () => {
    /*
     * 24 pairs x 3 raters = 72 judgments: enough to measure agreement and
     * workflow burden without turning a methodology pilot into a ranking
     * exercise. All 66 pairs would.
     */
    expect(pilotPairs(twelve)).toHaveLength(24);
    expect(allPairs(twelve)).toHaveLength(66);
  });

  it('gives every deck degree 4', () => {
    const deg = new Map(twelve.map((d) => [d, 0]));
    for (const { a, b } of pilotPairs(twelve)) {
      deg.set(a, deg.get(a)! + 1);
      deg.set(b, deg.get(b)! + 1);
    }
    for (const [deck, d] of deg) expect(d, deck).toBe(PILOT_DEGREE);
  });

  it('produces a connected comparison graph', () => {
    // A disconnected graph cannot yield a single global ordering.
    const adj = new Map(twelve.map((d) => [d, [] as string[]]));
    for (const { a, b } of pilotPairs(twelve)) {
      adj.get(a)!.push(b);
      adj.get(b)!.push(a);
    }
    const seen = new Set([twelve[0]!]);
    const queue = [twelve[0]!];
    while (queue.length > 0) {
      for (const next of adj.get(queue.shift()!)!) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    expect(seen.size).toBe(twelve.length);
  });

  it('covers every deck and never pairs one with itself', () => {
    const pairs = pilotPairs(twelve);
    const covered = new Set(pairs.flatMap((p) => [p.a, p.b]));
    expect(covered.size).toBe(twelve.length);
    for (const { a, b } of pairs) expect(a).not.toBe(b);
  });

  it('contains no duplicate pair', () => {
    const norm = (p: { a: string; b: string }) =>
      p.a < p.b ? `${p.a}|${p.b}` : `${p.b}|${p.a}`;
    const pairs = pilotPairs(twelve);
    expect(new Set(pairs.map(norm)).size).toBe(pairs.length);
  });

  it('gives all raters the SAME logical pairs', () => {
    // Agreement must be measured on identical questions.
    const norm = (p: { a: string; b: string }) =>
      p.a < p.b ? `${p.a}|${p.b}` : `${p.b}|${p.a}`;
    const shared = pilotPairs(twelve);
    const bundles = ['r1', 'r2', 'r3'].map((r, i) =>
      buildRaterBundle(r, twelve, shared, 1 + i * 1000),
    );
    const expected = new Set(shared.map(norm));
    for (const b of bundles) {
      expect(new Set(b.pairs.map(norm))).toEqual(expected);
    }
  });

  it('reproduces identically from the same seed', () => {
    const a = buildRaterBundle('r1', twelve, pilotPairs(twelve), 7);
    const b = buildRaterBundle('r1', twelve, pilotPairs(twelve), 7);
    expect(a).toEqual(b);
  });
});

describe('generic pair sampling', () => {

  it('never pairs a deck with itself and never repeats a pair', () => {
    const p = samplePairs(ids(30), 8, 1);
    const seen = new Set<string>();
    for (const { a, b } of p) {
      expect(a).not.toBe(b);
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('gives every deck at least one comparison', () => {
    // A deck no one compared contributes nothing to a global ordering.
    for (const n of [12, 30, 50]) {
      const deckIds = ids(n);
      const counts = new Map(deckIds.map((d) => [d, 0]));
      for (const { a, b } of samplePairs(deckIds, 8, 7)) {
        counts.set(a, counts.get(a)! + 1);
        counts.set(b, counts.get(b)! + 1);
      }
      for (const [deck, c] of counts) expect(c, `${n}/${deck}`).toBeGreaterThan(0);
    }
  });

  it('keeps the comparison graph close to regular', () => {
    const deckIds = ids(30);
    const counts = new Map(deckIds.map((d) => [d, 0]));
    for (const { a, b } of samplePairs(deckIds, 8, 3)) {
      counts.set(a, counts.get(a)! + 1);
      counts.set(b, counts.get(b)! + 1);
    }
    const values = [...counts.values()];
    // Allocating to the least-compared deck should keep the spread tight.
    expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(3);
  });

  it('is deterministic for a given seed and differs across seeds', () => {
    const deckIds = ids(20);
    expect(samplePairs(deckIds, 6, 42)).toEqual(samplePairs(deckIds, 6, 42));
    expect(samplePairs(deckIds, 6, 42)).not.toEqual(samplePairs(deckIds, 6, 43));
  });

  it('caps requested comparisons at the number of available opponents', () => {
    // 5 decks cannot each have 10 distinct opponents.
    const p = samplePairs(ids(5), 10, 1);
    expect(p).toHaveLength((5 * 4) / 2);
  });

  it('returns nothing for degenerate input', () => {
    expect(samplePairs([], 6, 1)).toEqual([]);
    expect(samplePairs(ids(1), 6, 1)).toEqual([]);
    expect(samplePairs(ids(10), 0, 1)).toEqual([]);
  });
});

describe('rater bundles', () => {
  const twelve = ids(12);

  it('randomises deck order per rater without dropping decks', () => {
    const a = buildRaterBundle('r1', twelve, pilotPairs(twelve), 1);
    const b = buildRaterBundle('r2', twelve, pilotPairs(twelve), 2);
    expect([...a.deckOrder].sort()).toEqual([...twelve].sort());
    expect(a.deckOrder).not.toEqual(b.deckOrder);
  });

  it('randomises each pair orientation so side preference cannot bias every judgment', () => {
    const bundle = buildRaterBundle('r1', twelve, pilotPairs(twelve), 5);
    const original = new Set(pilotPairs(twelve).map((p) => `${p.a}|${p.b}`));
    const flipped = bundle.pairs.filter((p) => !original.has(`${p.a}|${p.b}`));
    expect(flipped.length).toBeGreaterThan(0);
    expect(flipped.length).toBeLessThan(bundle.pairs.length);
  });

  it('preserves every pair as an unordered set', () => {
    const bundle = buildRaterBundle('r1', twelve, pilotPairs(twelve), 9);
    const norm = (p: { a: string; b: string }) => (p.a < p.b ? `${p.a}|${p.b}` : `${p.b}|${p.a}`);
    expect(new Set(bundle.pairs.map(norm))).toEqual(new Set(pilotPairs(twelve).map(norm)));
  });
});

describe('bundle rendering', () => {
  const decks: DeckForBundle[] = ids(3).map((id) => ({
    id,
    decklist: '1 Sol Ring\n1 Arcane Signet\n36 Forest',
  }));
  const bundle = buildRaterBundle('r1', decks.map((d) => d.id), allPairs(decks.map((d) => d.id)), 1);

  it('renders a blind, self-contained worksheet', () => {
    const text = renderRaterBundle(bundle, decks);
    expect(text).toMatch(/Part A/);
    expect(text).toMatch(/Part B/);
    expect(text).toMatch(/Sol Ring/);
    for (const d of decks) expect(text).toContain(d.id);
  });

  it('asks nine rubric questions per deck, not ten', () => {
    /*
     * cEDH staple density was removed: it is mechanically derivable from a
     * card list, so a human should not spend judgment on it, and keeping
     * competitive-tier vocabulary out of the rater's view is a bonus.
     */
    const text = renderRaterBundle(bundle, decks);
    const firstDeck = text.split('## Deck ')[1] ?? '';
    const numbered = firstDeck.match(/^\| \d+ \| /gm) ?? [];
    expect(numbered).toHaveLength(9);
    expect(text).not.toMatch(/competitive decks/i);
  });

  it('states the outcome-based power definition and no mechanism', () => {
    const text = renderRaterBundle(bundle, decks);
    expect(text).toMatch(/four-player game/);
    expect(text).toMatch(/only wins when unopposed/);
  });

  it('offers tie as an explicit answer', () => {
    expect(renderRaterBundle(bundle, decks)).toMatch(/tie/);
  });

  it('refuses to render when deck data leaks model information', () => {
    const leaky = [{ id: 'deck-a000', decklist: '1 Sol Ring\n// Composite Power Index 55' }];
    const b = buildRaterBundle('r1', ['deck-a000'], [], 1);
    expect(() => renderRaterBundle(b, leaky)).toThrow(/leaks model information/);
  });

  it('fails loudly when a bundle references a missing deck', () => {
    expect(() => renderRaterBundle(bundle, decks.slice(0, 1))).toThrow(/unknown deck/);
  });
});

describe('pilot coverage', () => {
  const meta = (i: number, tier: DeckMeta['believedTier'], anchor = false): DeckMeta => ({
    id: `deck-${(i + 0xb000).toString(16)}`,
    commander: 'Someone',
    source: 'community',
    believedTier: tier,
    archetypeNotes: '',
    anchor,
    split: 'calibration',
    decklistVersion: '2026-08-25',
  });

  const wellFormed = (): DeckMeta[] => [
    meta(0, 'precon', true), meta(1, 'precon'),
    meta(2, 'casual', true), meta(3, 'casual'),
    meta(4, 'focused'),
    meta(5, 'optimized', true), meta(6, 'optimized'),
    meta(7, 'high_power'), meta(8, 'high_power'),
    meta(9, 'cedh'), meta(10, 'cedh'),
    meta(11, 'incoherent'),
  ];

  it('expects twelve decks', () => {
    expect(PILOT_DECK_COUNT).toBe(12);
    expect(wellFormed()).toHaveLength(12);
  });

  it('accepts a corpus spanning the full tier range', () => {
    expect(checkPilotCoverage(wellFormed())).toEqual([]);
  });

  it('reports a shortfall when a tier is missing', () => {
    // The nine existing fixtures are all mid-power; that must not recur.
    const noAnchorsNoExtremes = wellFormed().filter((d) => d.believedTier !== 'cedh');
    const issues = checkPilotCoverage(noAnchorsNoExtremes);
    expect(issues.some((i) => i.kind === 'tier_shortfall' && i.detail.includes('cedh'))).toBe(true);
  });

  it('requires an incoherent deck so the model floor is tested', () => {
    const issues = checkPilotCoverage(wellFormed().filter((d) => d.believedTier !== 'incoherent'));
    expect(issues.some((i) => i.detail.includes('incoherent'))).toBe(true);
  });

  it('rejects an id that leaks the deck identity', () => {
    const decks = wellFormed();
    decks[0] = { ...decks[0]!, id: 'storm-combo-kess' };
    const issues = checkPilotCoverage(decks);
    expect(issues.some((i) => i.kind === 'id_leaks_identity')).toBe(true);
  });

  it('detects duplicate ids', () => {
    const decks = wellFormed();
    decks[1] = { ...decks[1]!, id: decks[0]!.id };
    expect(checkPilotCoverage(decks).some((i) => i.kind === 'duplicate_id')).toBe(true);
  });

  it('requires exactly three anchors', () => {
    const decks = wellFormed().map((d) => ({ ...d, anchor: false }));
    expect(checkPilotCoverage(decks).some((i) => i.kind === 'anchor_count')).toBe(true);
  });
});
