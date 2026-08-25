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

## Power dimensions (Phase 4B)

Deterministic 0-100 scores over the Phase 4A evidence layer. Each is a pure
standalone scorer with its own evaluator (`npm run eval:<name>`); none is
attached to `DeckProfile`.

**Implemented and frozen:**

| Dimension | Question | Components |
|---|---|---|
| **Speed** | How soon can the deck execute? | development 40 / win speed 60 |
| **Consistency** | How reliably can it access and reproduce its plan? | targeted access 30 / selection 20 / card flow 15 / redundancy 25 / commander access 10 |
| **Interaction** | How effectively can it disrupt opponents? | availability 25 / efficiency 25 / coverage 15 / stack 15 / stax 10 / graveyard 5 / board reset 5 |
| **Resilience** | How well does it continue after disruption? | recovery 35 / protection 25 / weakest-link redundancy 25 / commander backup 15 |

**Investigated and deferred as independent dimensions:**

| Candidate | Why deferred |
|---|---|
| Card Advantage (4B.5) | Could not be separated from `Consistency.cardFlow`; non-card resources route to Speed |
| Efficiency (4B.6) | Evidence measures cost, and raw cost is largely archetype identity; leverage and quantitative cost reduction unavailable |
| Win-Plan Quality (4B.7) | Non-timing win evidence reconstructs Speed (r=0.83); win-plan coverage absent for 3 of 9 real fixtures |

### Composite Power Index (Phase 4C)

```
Power Profile                       <- the primary interpretation
  |- Speed
  |- Consistency
  |- Interaction
  |- Resilience

Composite Power Index               <- a compact summary of the profile
  |- geometric mean of the four frozen dimensions
```

`assessCompositePower()` returns a `CompositePowerIndex`: the index `score`, the
four `dimensions` it came from, `diagnostics` (weakest dimension, its score, and
the arithmetic mean for comparison), and `limitations`.

The geometric mean was chosen over the arithmetic mean semantically: arithmetic
ranks a 80/80/80/10 profile *above* a balanced 60/60/60/60, which would assert
that a near-absent capacity is fully purchasable with excess elsewhere. The
geometric mean treats the dimensions as partially complementary instead, with no
tuning constant. A true zero in any dimension yields zero, deliberately and
without an epsilon.

**It is an uncalibrated internal index, not an absolute power measurement.** A
cross-dimension commensurability audit found the four scales are not fully
ratio-comparable: Speed's attainable ceiling for non-combo decks is about 69,
against roughly 100 for the other three, so equal numbers do not mark equal
positions and the index under-weights Speed strength. Rankings are indicative
rather than settled — several real fixtures sit within ~1.5 points and reorder
under modest hypothetical recalibration of any single dimension.

Accordingly it emits **no** rating band, no 1-10 mapping, and no
casual/high-power/cEDH label; the individual-dimension bands are deliberately
not reused. `EVIDENCE-BACKLOG.md` records the labelled-corpus calibration work
that would be needed before any of that becomes trustworthy.

**"Deferred as an independent dimension" does not mean the concept is absent
from the system.** Card-flow evidence remains part of Consistency; mana
efficiency is represented wherever the existing dimensions legitimately consume
it; win-plan evidence remains part of Speed, where it is currently frozen.

The conclusion of Phase 4B is that current deterministic evidence supports four
sufficiently distinct, broadly applicable power dimensions — Speed, Consistency,
Interaction, Resilience. Additional candidates were explicitly investigated and
rejected rather than forced into the model.

These four are **not** claimed to be theoretically exhaustive. They are the
dimensions currently justified by the available deterministic evidence. Each
deferral in `EVIDENCE-BACKLOG.md` carries the concrete conditions under which it
should be revisited.

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
