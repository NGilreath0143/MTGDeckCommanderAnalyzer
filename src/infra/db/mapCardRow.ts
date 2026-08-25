import { COLOR_CODES, type ColorCode, type Legality, type ResolvedCard } from '@/domain/types';

/**
 * The ONLY producer of ResolvedCard.
 *
 * Every card reaches the domain through this function, whether it came from
 * the cache or was fetched a moment ago, so cache-vs-network can never change
 * analysis results.
 */

/** The Card columns this mapper needs; keeps the signature Prisma-agnostic. */
export interface CardRowLike {
  scryfallId: string;
  oracleId: string;
  name: string;
  manaCost: string | null;
  cmc: number;
  typeLine: string;
  colorIdentity: string[];
  colors: string[];
  layout: string;
  keywords: string[];
  oracleText: string;
  commanderLegality: string;
  /**
   * Full raw Scryfall payload, retained by the Card table since Phase 1.
   * Read-only here: `produced_mana` is surfaced onto ResolvedCard for
   * mana-base analysis without a schema change.
   */
  scryfallJson?: unknown;
}

const LEGALITIES = new Set<Legality>(['legal', 'not_legal', 'restricted', 'banned']);

function toColors(values: string[]): ColorCode[] {
  return COLOR_CODES.filter((c) => values.includes(c));
}

/**
 * Colors a land/permanent can produce, per Scryfall's `produced_mana`.
 *
 * Not derivable from oracle text: only 80% of Commander-legal lands match a
 * text rule, because duals and Triomes state their mana ability entirely in
 * parenthetical reminder text, which reminder-stripping (correctly) removes.
 */
function extractProducedMana(raw: unknown): ColorCode[] | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const produced = (raw as { produced_mana?: unknown }).produced_mana;
  if (!Array.isArray(produced)) return undefined;
  return COLOR_CODES.filter((c) => produced.includes(c));
}

export function mapCardRow(row: CardRowLike): ResolvedCard {
  const producedMana = extractProducedMana(row.scryfallJson);
  return {
    scryfallId: row.scryfallId,
    oracleId: row.oracleId,
    name: row.name,
    manaCost: row.manaCost,
    cmc: row.cmc,
    typeLine: row.typeLine,
    colorIdentity: toColors(row.colorIdentity),
    colors: toColors(row.colors),
    layout: row.layout,
    keywords: row.keywords,
    oracleText: row.oracleText,
    commanderLegality: LEGALITIES.has(row.commanderLegality as Legality)
      ? (row.commanderLegality as Legality)
      : 'not_legal',
    ...(producedMana ? { producedMana } : {}),
  };
}
