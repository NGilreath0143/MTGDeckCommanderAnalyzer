import type { ResolvedCard } from '@/domain/types';
import type { CardRecordInput } from '@/infra/scryfall/mapScryfallCard';
import { prisma } from './prisma';
import { mapCardRow } from './mapCardRow';

/**
 * The local Scryfall card cache.
 *
 * The contract used by the pipeline, so tests can substitute an in-memory
 * implementation without touching Postgres.
 */
export interface CardRepo {
  findByNormalizedNames(keys: string[]): Promise<ResolvedCard[]>;
  upsertMany(records: CardRecordInput[]): Promise<ResolvedCard[]>;
}

export const cardRepo: CardRepo = {
  async findByNormalizedNames(keys) {
    if (keys.length === 0) return [];
    const rows = await prisma.card.findMany({
      where: { normalizedName: { in: keys } },
    });
    return rows.map(mapCardRow);
  },

  async upsertMany(records) {
    if (records.length === 0) return [];

    // Upsert on normalizedName, the cache key: a reprint of a card we already
    // have should refresh that row rather than collide with it.
    const saved = await prisma.$transaction(
      records.map((r) =>
        prisma.card.upsert({
          where: { normalizedName: r.normalizedName },
          create: {
            scryfallId: r.scryfallId,
            oracleId: r.oracleId,
            name: r.name,
            normalizedName: r.normalizedName,
            manaCost: r.manaCost,
            cmc: r.cmc,
            typeLine: r.typeLine,
            colorIdentity: r.colorIdentity,
            colors: r.colors,
            layout: r.layout,
            keywords: r.keywords,
            oracleText: r.oracleText,
            commanderLegality: r.commanderLegality,
            scryfallJson: r.scryfallJson as object,
          },
          update: {
            scryfallId: r.scryfallId,
            oracleId: r.oracleId,
            name: r.name,
            manaCost: r.manaCost,
            cmc: r.cmc,
            typeLine: r.typeLine,
            colorIdentity: r.colorIdentity,
            colors: r.colors,
            layout: r.layout,
            keywords: r.keywords,
            oracleText: r.oracleText,
            commanderLegality: r.commanderLegality,
            scryfallJson: r.scryfallJson as object,
          },
        }),
      ),
    );

    return saved.map(mapCardRow);
  },
};
