import { isLand, manaPips, primaryCardType } from './cardFacts';
import {
  COLOR_CODES,
  type CardType,
  type ColorCode,
  type DeckComposition,
  type DeckStats,
  type ResolvedCard,
} from './types';

/** Deterministic deck metrics. Pure. */

type Entry = { card: ResolvedCard; quantity: number };

/** Highest explicit curve bucket; everything above lands in "7+". */
export const MAX_CURVE_BUCKET = 7;

const ALL_TYPES: readonly CardType[] = [
  'Creature',
  'Instant',
  'Sorcery',
  'Artifact',
  'Enchantment',
  'Planeswalker',
  'Battle',
  'Land',
  'Other',
];

function emptyTypeDistribution(): Record<CardType, number> {
  return Object.fromEntries(ALL_TYPES.map((t) => [t, 0])) as Record<CardType, number>;
}

export function countCards(entries: Entry[]): number {
  return entries.reduce((sum, e) => sum + e.quantity, 0);
}

/**
 * Mana curve over nonland cards, bucketed 0..6 with a "7+" bucket.
 * Uses top-level cmc, which is correct for modal DFCs.
 */
export function computeManaCurve(entries: Entry[]): Record<string, number> {
  const curve: Record<string, number> = {};
  for (let i = 0; i < MAX_CURVE_BUCKET; i += 1) curve[String(i)] = 0;
  curve[`${MAX_CURVE_BUCKET}+`] = 0;

  for (const { card, quantity } of entries) {
    if (isLand(card)) continue;
    // Fractional (Un-set) values round down into their bucket.
    const mv = Math.floor(card.cmc);
    const key = mv >= MAX_CURVE_BUCKET ? `${MAX_CURVE_BUCKET}+` : String(Math.max(0, mv));
    curve[key] = (curve[key] ?? 0) + quantity;
  }
  return curve;
}

/**
 * Average mana value over nonland cards only. Lands are excluded
 * deliberately: including ~37 zero-cost lands drags every Commander deck
 * toward ~2.0, which is not what players mean by "average MV".
 */
export function computeAverageManaValue(entries: Entry[]): number {
  const nonland = entries.filter((e) => !isLand(e.card));
  const count = countCards(nonland);
  if (count === 0) return 0;
  const total = nonland.reduce((sum, e) => sum + e.card.cmc * e.quantity, 0);
  // Two decimals is plenty and keeps the JSON stable.
  return Math.round((total / count) * 100) / 100;
}

/** Each card counted once, so the buckets sum to the deck size. */
export function computeTypeDistribution(entries: Entry[]): Record<CardType, number> {
  const dist = emptyTypeDistribution();
  for (const { card, quantity } of entries) {
    dist[primaryCardType(card.typeLine)] += quantity;
  }
  return dist;
}

/** Coloured pip counts across all mana costs, plus a colorless bucket. */
export function computeColorDistribution(entries: Entry[]): Record<ColorCode | 'C', number> {
  const dist: Record<ColorCode | 'C', number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  for (const { card, quantity } of entries) {
    const pips = manaPips(card.manaCost);
    for (const key of Object.keys(dist) as (ColorCode | 'C')[]) {
      dist[key] += pips[key] * quantity;
    }
  }
  return dist;
}

/** How many cards' colour identity includes each colour. */
export function computeColorIdentityDistribution(entries: Entry[]): Record<ColorCode, number> {
  const dist: Record<ColorCode, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const { card, quantity } of entries) {
    for (const color of COLOR_CODES) {
      if (card.colorIdentity.includes(color)) dist[color] += quantity;
    }
  }
  return dist;
}

/**
 * Full deck statistics. Commanders are included in counts and distributions
 * (they are part of the 100) but excluded from the curve and average mana
 * value, which describe the deck you draw from.
 */
export function computeStats(composition: DeckComposition): DeckStats {
  const commanderEntries: Entry[] = composition.commanders.map((card) => ({
    card,
    quantity: 1,
  }));
  const all: Entry[] = [...commanderEntries, ...composition.mainboard];

  const landCount = countCards(all.filter((e) => isLand(e.card)));
  const total = countCards(all);

  return {
    totalCards: total,
    landCount,
    nonlandCount: total - landCount,
    averageManaValue: computeAverageManaValue(composition.mainboard),
    manaCurve: computeManaCurve(composition.mainboard),
    typeDistribution: computeTypeDistribution(all),
    colorDistribution: computeColorDistribution(all),
    colorIdentityDistribution: computeColorIdentityDistribution(all),
  };
}
