# Commander Deck Analyzer

Deterministic profiling for Magic: The Gathering Commander decks. Paste a
decklist as text; get back a validated, structured `DeckProfile`.

This is phase one, intentionally scoped to a **deterministic engine**: no LLM,
no recommendations, no power-level scoring. The architecture leaves seams for
those (see [Extending](#extending)).

## Quick start

```bash
npm install
cp .env.example .env         # DATABASE_URL points at the Docker Postgres
npm run db:up                # Postgres 16 on port 5433
npm run db:migrate           # apply the schema
npm run db:generate          # generate the Prisma client into src/generated
npm run dev                  # http://localhost:3000
```

Then paste a decklist into the textarea, or call the API:

```bash
curl -X POST localhost:3000/api/decks \
  -H 'Content-Type: application/json' \
  -d '{"text":"1 Atraxa, Praetors'\'' Voice\n1 Sol Ring"}'
```

```bash
npm test          # 193 unit tests, no network access
npm run typecheck
```

## How it works

`POST /api/decks` and the page both call one orchestrator, `importDeck`:

1. **Parse** the text into `{ quantity, name, section }` entries.
2. **Resolve** names cache-first: one Postgres query, then batch the misses to
   Scryfall's `/cards/collection` (≤75 per request, throttled).
3. **Identify** the commander — an explicit `Commander:` section wins, else the
   first eligible legendary.
4. **Validate**: exactly 100 cards, singleton (basics exempt), colour identity,
   Commander legality.
5. **Compute**: land count, average mana value, mana curve, type distribution,
   colour distribution.
6. **Persist** the deck and return the `DeckProfile`.

An invalid deck is **not** an HTTP error: you get `200` with a populated
`validation.issues[]` *and* the metrics, so the UI can show both.

## Architecture

Three layers, enforced by import direction:

| Layer | Path | Rule |
|---|---|---|
| Domain | `src/domain/` | **Pure.** Never imports Prisma, `fetch`, or Next. Nearly all tests live here. |
| Infra | `src/infra/` | I/O only: Scryfall HTTP, Prisma, repositories. No analysis logic. |
| Orchestration | `src/pipeline/`, `src/app/` | The only place I/O meets domain. |

The key seam: domain code never sees a Prisma model or a raw Scryfall payload.
It sees exactly one type, `ResolvedCard`, and `mapCardRow` is its **only**
producer — so a freshly fetched card and a cached card reach the analyzer by an
identical path and can never behave differently.

`importDeck` takes an optional deps argument (repos + Scryfall client), so
tests inject in-memory fakes and never touch Postgres or the network.

## Non-obvious details

These were verified against the live Scryfall API, and each drives code:

- **Modal DFCs** carry a top-level `cmc` but *no* `cmc` on their faces. Mana
  value always comes from the top level; type parsing uses the **front face**,
  so `Malakir Rebirth // Malakir Mire` is an Instant, not a Land.
- **`not_found` echoes back the identifier objects you sent**, not names.
- **Scryfall canonicalizes names** (`Nazgul` → `Nazgûl`, and it accepts a
  missing apostrophe). Cache keys are therefore accent- and
  punctuation-insensitive, and a fetched card is also indexed under the name the
  user typed — otherwise a correct card would look unresolved.
- **Commander eligibility is not just "Legendary Creature".** 32 cards print
  "can be your commander" (Estrid, Freyalise, …). `Grist, the Hunger Tide` is
  legal by *rules-committee ruling* with nothing in the card data to say so, so
  `commander.ts` carries a short, documented exception list.
- **Type distribution uses fixed precedence** (`Land > Creature > …`) so buckets
  sum to the deck size and `landCount` can never contradict
  `typeDistribution.Land` (e.g. Dryad Arbor).
- **Average mana value excludes lands and commanders.** Including ~37 lands
  drags every deck toward ~2.0, which is not what players mean.
- **Quantity parsing caps at three digits**, so `1996 World Champion` keeps its
  name instead of being read as 1996 copies.

## Evaluating the role classifier

`src/eval/` is developer-only tooling for measuring role-classification quality.
It is never imported by `src/app/`, `src/pipeline/`, `src/infra/`, or
`src/domain/` — a test in `tests/eval/boundaries.test.ts` enforces that.

```bash
npm run eval:golden    # 200 manually labeled cases; exits non-zero on a violation
npm run eval:corpus    # classify the ~31.8k Commander-legal cards from bulk data
npm run eval:decks     # per-card roles and rule IDs for the fixture decks
```

**Golden set** (`src/eval/goldenSet.ts`) uses *partial* assertions: `expect`
roles must be present, `exclude` roles must be absent, and any other role is
unspecified and never fails a case. That keeps cases stable as the
(intentionally incomplete) taxonomy grows. Cases labeled `KNOWN GAP` document
false negatives on purpose, so a known miss shows up as a recall gap rather than
disappearing from the dataset.

`eval:golden` is the only script that can fail. Corpus totals and
suspicious-case signals are **informational**: a land classified as ramp is not
inherently wrong (`Treasure Vault` genuinely accelerates), so those outputs
exist to put cases in front of a human.

**The unclassified percentage is not a metric to reduce.** The nine roles are
deliberately partial — theft and hand disruption have no role at all — so most
cards correctly receive none.

**Bulk data** is fetched once into `.cache/` (gitignored, ~25MB) from Scryfall's
`oracle_cards` export. Cards are normalized through the existing
`mapScryfallCard` → `mapCardRow` chain, so `mapCardRow` remains the only
producer of `ResolvedCard` and the domain classifier never sees a raw Scryfall
object.

## Extending

Every planned feature is a new pure module plus an optional key on
`DeckProfile` — no interfaces or registries were built in advance.

- **Card roles** → `domain/roles.ts`. Reads `oracleText`/`typeLine`/`keywords`,
  already on `ResolvedCard`. No schema change.
- **Strategy analysis** → `domain/strategy.ts`, consumes roles, stays pure.
- **LLM analysis** → `infra/llm/` plus a separate
  `POST /api/decks/[id]/analysis` reading the persisted deck. Deliberately not
  in `importDeck`: keeping the import path deterministic is the point.
- **Recommendations / optimization** → need a card corpus beyond decks; add
  `infra/scryfall/bulk.ts` + an ingest script. `Card` is already the right shape.

`Card.scryfallJson` retains the full raw payload, so most future features need
no migration. `Deck.rawText` means any deck can be recomputed from scratch;
`Deck.profile` is a cache, never the source of truth.

## Notes

- Postgres runs on **5433** to avoid colliding with a local install.
- Prisma 7 specifics: the `prisma-client` generator with a mandatory `output`,
  connection URL in `prisma.config.ts` (not `schema.prisma`), an explicit
  `@prisma/adapter-pg` adapter, and no runtime `.env` loading (hence
  `dotenv/config` in `infra/db/prisma.ts`).
- `npm audit` reports a dev-only advisory in `deepmerge-ts`, reachable through
  the Prisma **CLI**. The suggested fix downgrades to Prisma 6; not applied.
- `AGENTS.md` / `CLAUDE.md` are generated by `next dev` and re-created on each run.
