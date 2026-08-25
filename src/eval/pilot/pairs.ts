import type { DeckId, RaterBundle, RaterId } from './types';

/**
 * Pair sampling and per-rater presentation order. Pure and deterministic.
 *
 * Determinism matters: a rater who loses their bundle must be able to
 * regenerate the identical one, and a reviewer must be able to reproduce what
 * was asked. Math.random() would make both impossible, so the seed is an
 * explicit input.
 */

/** Small deterministic PRNG (mulberry32). Adequate for shuffling a deck list. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Every unordered pair. Feasible only at pilot scale. */
export function allPairs(deckIds: readonly DeckId[]): { a: DeckId; b: DeckId }[] {
  const pairs: { a: DeckId; b: DeckId }[] = [];
  for (let i = 0; i < deckIds.length; i++) {
    for (let j = i + 1; j < deckIds.length; j++) {
      pairs.push({ a: deckIds[i]!, b: deckIds[j]! });
    }
  }
  return pairs;
}

/**
 * Sample roughly `perDeck` comparisons per deck.
 *
 * Paired-comparison theory needs O(n log n) comparisons for a stable global
 * ordering, so `perDeck` should scale like 2*log2(n) — about 10 at n=30 and 13
 * at n=100. At pilot scale (n=12) the complete graph is only 66 pairs, so
 * `pilotPairs` uses every pair instead and gets full connectivity for free.
 *
 * Comparisons are allocated to the decks with the fewest so far, which keeps
 * the comparison graph close to regular and avoids a deck that no one rated.
 */
export function samplePairs(
  deckIds: readonly DeckId[],
  perDeck: number,
  seed: number,
): { a: DeckId; b: DeckId }[] {
  const n = deckIds.length;
  if (n < 2 || perDeck < 1) return [];

  const target = Math.min(perDeck, n - 1);
  const rng = makeRng(seed);
  const count = new Map<DeckId, number>(deckIds.map((d) => [d, 0]));
  const used = new Set<string>();
  const pairs: { a: DeckId; b: DeckId }[] = [];
  const key = (a: DeckId, b: DeckId) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  const needed = Math.ceil((n * target) / 2);
  // Bounded: every iteration either emits a pair or exhausts a candidate.
  for (let guard = 0; pairs.length < needed && guard < needed * 50; guard++) {
    const byNeed = [...deckIds].sort(
      (x, y) => (count.get(x) ?? 0) - (count.get(y) ?? 0) || (rng() < 0.5 ? -1 : 1),
    );
    const a = byNeed[0]!;
    const partner = byNeed
      .slice(1)
      .find((b) => !used.has(key(a, b)) && (count.get(b) ?? 0) < target);
    if (!partner) {
      // `a` cannot be paired further; if nobody can, we are done.
      const anyLeft = deckIds.some(
        (x) =>
          (count.get(x) ?? 0) < target &&
          deckIds.some((y) => y !== x && !used.has(key(x, y)) && (count.get(y) ?? 0) < target),
      );
      if (!anyLeft) break;
      continue;
    }
    used.add(key(a, partner));
    count.set(a, (count.get(a) ?? 0) + 1);
    count.set(partner, (count.get(partner) ?? 0) + 1);
    pairs.push({ a, b: partner });
  }
  return pairs;
}

/**
 * Build one rater's bundle.
 *
 * Deck order and each pair's left/right orientation are both randomised per
 * rater: a fixed order would let position prime the judgment, and a fixed
 * orientation would let a rater's side preference bias every comparison the
 * same way.
 */
export function buildRaterBundle(
  raterId: RaterId,
  deckIds: readonly DeckId[],
  pairs: readonly { a: DeckId; b: DeckId }[],
  seed: number,
): RaterBundle {
  const rng = makeRng(seed);
  return {
    raterId,
    deckOrder: shuffled(deckIds, rng),
    pairs: shuffled(pairs, rng).map((p) => (rng() < 0.5 ? p : { a: p.b, b: p.a })),
  };
}

/** Comparisons each deck should appear in during the pilot. */
export const PILOT_DEGREE = 4;

/**
 * The pilot's shared pair set: 24 pairs over 12 decks, degree 4 each.
 *
 * Deliberately NOT the complete graph. All 66 pairs would turn a methodology
 * pilot into a ranking exercise, and the pilot's job is to measure agreement
 * and workflow burden — 24 pairs x 3 raters = 72 judgments is enough for that.
 *
 * All raters judge the SAME logical pairs, so inter-rater agreement is
 * measured on identical questions. Only presentation order and left/right
 * orientation vary per rater.
 *
 * Construction is a circulant graph: each deck is paired with the decks at
 * offsets 1 and 2 around a ring. That guarantees connectivity (the offset-1
 * ring alone is a Hamiltonian cycle) and exact regularity, which random
 * sampling cannot promise.
 */
export function pilotPairs(deckIds: readonly DeckId[]): { a: DeckId; b: DeckId }[] {
  const n = deckIds.length;
  if (n < 3) return allPairs(deckIds);

  const pairs: { a: DeckId; b: DeckId }[] = [];
  const seen = new Set<string>();
  const key = (a: DeckId, b: DeckId) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  for (const offset of [1, 2]) {
    for (let i = 0; i < n; i++) {
      const a = deckIds[i]!;
      const b = deckIds[(i + offset) % n]!;
      if (a === b) continue;
      const k = key(a, b);
      if (seen.has(k)) continue;
      seen.add(k);
      pairs.push({ a, b });
    }
  }
  return pairs;
}
