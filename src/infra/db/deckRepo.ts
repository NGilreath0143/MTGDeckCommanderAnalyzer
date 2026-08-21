import type { DeckProfile, DeckSection } from '@/domain/types';
import { prisma } from './prisma';

/** Persistence for imported decks. */

export interface DeckCardInput {
  rawName: string;
  quantity: number;
  section: DeckSection;
  isCommander: boolean;
  lineNumber: number;
  /** Null when the name could not be resolved. */
  scryfallId: string | null;
}

export interface CreateDeckInput {
  name: string | null;
  rawText: string;
  entries: DeckCardInput[];
  profile: DeckProfile;
}

export interface DeckRepo {
  create(input: CreateDeckInput): Promise<{ id: string }>;
  updateProfile(deckId: string, profile: DeckProfile): Promise<void>;
}

export const deckRepo: DeckRepo = {
  async create(input) {
    // Resolve scryfallIds to Card primary keys in one query.
    const scryfallIds = input.entries
      .map((e) => e.scryfallId)
      .filter((id): id is string => id !== null);

    const cards = scryfallIds.length
      ? await prisma.card.findMany({
          where: { scryfallId: { in: scryfallIds } },
          select: { id: true, scryfallId: true },
        })
      : [];
    const cardIdByScryfallId = new Map(cards.map((c) => [c.scryfallId, c.id]));

    const deck = await prisma.deck.create({
      data: {
        name: input.name,
        rawText: input.rawText,
        profile: input.profile as unknown as object,
        cards: {
          create: input.entries.map((e) => ({
            rawName: e.rawName,
            quantity: e.quantity,
            section: e.section,
            isCommander: e.isCommander,
            lineNumber: e.lineNumber,
            cardId: e.scryfallId ? cardIdByScryfallId.get(e.scryfallId) ?? null : null,
          })),
        },
      },
      select: { id: true },
    });

    return deck;
  },

  async updateProfile(deckId, profile) {
    await prisma.deck.update({
      where: { id: deckId },
      data: { profile: profile as unknown as object },
    });
  },
};
