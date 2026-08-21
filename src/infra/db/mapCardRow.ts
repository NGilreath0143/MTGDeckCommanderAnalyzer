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
}

const LEGALITIES = new Set<Legality>(['legal', 'not_legal', 'restricted', 'banned']);

function toColors(values: string[]): ColorCode[] {
  return COLOR_CODES.filter((c) => values.includes(c));
}

export function mapCardRow(row: CardRowLike): ResolvedCard {
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
  };
}
