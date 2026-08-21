-- CreateTable
CREATE TABLE "Card" (
    "id" TEXT NOT NULL,
    "scryfallId" TEXT NOT NULL,
    "oracleId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "manaCost" TEXT,
    "cmc" DOUBLE PRECISION NOT NULL,
    "typeLine" TEXT NOT NULL,
    "colorIdentity" TEXT[],
    "colors" TEXT[],
    "layout" TEXT NOT NULL,
    "keywords" TEXT[],
    "oracleText" TEXT NOT NULL,
    "commanderLegality" TEXT NOT NULL,
    "scryfallJson" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Card_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deck" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "rawText" TEXT NOT NULL,
    "profile" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeckCard" (
    "id" TEXT NOT NULL,
    "deckId" TEXT NOT NULL,
    "cardId" TEXT,
    "rawName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "section" TEXT NOT NULL,
    "isCommander" BOOLEAN NOT NULL DEFAULT false,
    "lineNumber" INTEGER NOT NULL,

    CONSTRAINT "DeckCard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Card_scryfallId_key" ON "Card"("scryfallId");

-- CreateIndex
CREATE UNIQUE INDEX "Card_normalizedName_key" ON "Card"("normalizedName");

-- CreateIndex
CREATE INDEX "Card_oracleId_idx" ON "Card"("oracleId");

-- CreateIndex
CREATE INDEX "Card_name_idx" ON "Card"("name");

-- CreateIndex
CREATE INDEX "Deck_createdAt_idx" ON "Deck"("createdAt");

-- CreateIndex
CREATE INDEX "DeckCard_deckId_idx" ON "DeckCard"("deckId");

-- CreateIndex
CREATE INDEX "DeckCard_cardId_idx" ON "DeckCard"("cardId");

-- AddForeignKey
ALTER TABLE "DeckCard" ADD CONSTRAINT "DeckCard_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "Deck"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeckCard" ADD CONSTRAINT "DeckCard_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE;
