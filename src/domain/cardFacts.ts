import { COLOR_CODES, type CardType, type ColorCode, type ResolvedCard } from './types';

/**
 * Predicates and small derivations over a single card. Pure.
 *
 * Multi-faced cards: Scryfall gives a joined type line ("Instant // Land")
 * and, for modal DFCs, a top-level `cmc` with no per-face cmc. So everything
 * here reads the FRONT face of the type line, and mana value always comes
 * from the top-level `cmc`.
 */

/** The front face of a possibly-joined type line. */
export function frontFace(typeLine: string): string {
  const idx = typeLine.indexOf('//');
  return idx === -1 ? typeLine.trim() : typeLine.slice(0, idx).trim();
}

/**
 * Type precedence. Land first so `landCount` can never disagree with
 * `typeDistribution.Land` (e.g. Dryad Arbor, a Land Creature). Creature
 * next so "Artifact Creature" counts as a Creature.
 */
const TYPE_PRECEDENCE: readonly CardType[] = [
  'Land',
  'Creature',
  'Planeswalker',
  'Battle',
  'Instant',
  'Sorcery',
  'Artifact',
  'Enchantment',
];

function hasType(frontTypeLine: string, type: CardType): boolean {
  return new RegExp(`\\b${type}\\b`, 'i').test(frontTypeLine);
}

/** Every card type present on the front face. */
export function cardTypes(typeLine: string): CardType[] {
  const front = frontFace(typeLine);
  return TYPE_PRECEDENCE.filter((t) => hasType(front, t));
}

/**
 * The single bucket a card counts toward, so type distribution sums to the
 * deck size. Falls back to 'Other' for tribal/token/unknown lines.
 */
export function primaryCardType(typeLine: string): CardType {
  return cardTypes(typeLine)[0] ?? 'Other';
}

export function isLand(card: ResolvedCard): boolean {
  return hasType(frontFace(card.typeLine), 'Land');
}

/**
 * Basic lands are exempt from the singleton rule. Verified against Scryfall:
 * "Basic Land — Forest", "Basic Snow Land — Forest", and "Basic Land" (Wastes)
 * all carry the "Basic" supertype.
 */
export function isBasicLand(card: ResolvedCard): boolean {
  return /\bBasic\b/i.test(frontFace(card.typeLine)) && isLand(card);
}

export function isLegalInCommander(card: ResolvedCard): boolean {
  return card.commanderLegality === 'legal' || card.commanderLegality === 'restricted';
}

const EMPTY_PIPS = (): Record<ColorCode | 'C', number> => ({
  W: 0,
  U: 0,
  B: 0,
  R: 0,
  G: 0,
  C: 0,
});

/**
 * Count coloured mana pips in a mana cost.
 *
 * Each {...} symbol contributes at most one pip per colour it can be paid
 * with: "{G/W}" adds one G and one W, "{B/P}" adds one B, "{2/W}" adds one W.
 * Generic ("{3}") and true colorless ("{C}") both land in the C bucket.
 */
export function manaPips(manaCost: string | null): Record<ColorCode | 'C', number> {
  const pips = EMPTY_PIPS();
  if (!manaCost) return pips;

  for (const symbol of manaCost.match(/\{[^}]+\}/g) ?? []) {
    const inner = symbol.slice(1, -1).toUpperCase();
    const colors = COLOR_CODES.filter((c) => inner.split('/').includes(c));

    if (colors.length > 0) {
      for (const c of colors) pips[c] += 1;
      continue;
    }
    // {C} colorless, or generic {3}/{X}: count generic amounts numerically.
    if (inner === 'C') pips.C += 1;
    else {
      const generic = Number.parseInt(inner, 10);
      if (Number.isFinite(generic)) pips.C += generic;
    }
  }
  return pips;
}
