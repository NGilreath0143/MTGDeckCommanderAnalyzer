# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm test                      # vitest, 1127 tests, no network (tests/setup.ts throws on real fetch)
npx vitest run tests/domain/speed.test.ts        # one file
npx vitest run -t 'geometric mean'              # one test by name
npm run test:watch
npm run typecheck             # tsc --noEmit; strict + noUncheckedIndexedAccess

npm run db:up                 # Postgres 16 on 5433 (avoids a local install on 5432)
npm run db:migrate
npm run db:generate           # regenerates src/generated/prisma (gitignored)
npm run dev
```

Eval/pilot scripts (`npm run eval:*`, `npm run pilot:*`) are developer tooling, not tests.
They hit Postgres and Scryfall. `eval:golden` is the **only** one that can exit non-zero;
every other eval prints diagnostics for a human to read and always exits 0.

## Layering

Three layers, enforced by `tests/eval/boundaries.test.ts` — not by convention alone:

| Layer | Path | Rule |
|---|---|---|
| Domain | `src/domain/` | Pure. No Prisma, `fetch`, Next, or `@/infra`/`@/eval`/`@/app`/`@/pipeline` imports. |
| Infra | `src/infra/` | I/O only: Scryfall HTTP, Prisma, repos. No analysis logic. |
| Orchestration | `src/pipeline/`, `src/app/` | The only place I/O meets domain. |
| Eval | `src/eval/` | Dev-only. Must never be imported by any of the above. |

The boundary test also pins a list of domain modules that may import *only* other
domain modules. Adding an analysis module means adding it to that list.

**The key seam:** domain code sees exactly one card type, `ResolvedCard`, and
`infra/db/mapCardRow.ts` is its only producer. A freshly fetched card and a cached
card therefore reach the analyzer by an identical path and cannot behave differently.
Eval tooling routes bulk data through the same `mapScryfallCard` → `mapCardRow` chain
for the same reason. Do not construct a `ResolvedCard` anywhere else.

`importDeck` (`src/pipeline/importDeck.ts`) is the one orchestrator; it takes an
optional deps argument (repos + Scryfall client) so tests inject in-memory fakes
(`tests/pipeline/fakes.ts`). Real deps are imported lazily so injecting callers
never load Prisma.

`buildDeckProfile` (`src/domain/buildProfile.ts`) is the pure entry point: parsed
text + resolved-card map in, complete `DeckProfile` out. Every analysis layer is a
call in that one function.

## How analysis is layered

Each layer consumes only the one below it, and each is a pure standalone module:

```
parseDecklist → resolveCards → composeDeck → computeStats
                                           → roles (9 deterministic card roles)
                                           → tags → strategy → archetypes
                                           → powerEvidence
                                                 → speed / consistency / interaction / resilience
                                                       → compositePower (geometric mean)
```

`roles.ts` and `tags.ts` are the shared classification layer that everything
downstream depends on. `powerEvidence.ts` is the evidence layer the four power
dimensions read. The four dimension scorers and `compositePower` are **frozen** and
**not** attached to `DeckProfile` — they are reached through their own evaluators.

## Working conventions

**Phases are frozen once closed.** Read `README.md` for what each phase concluded and
`EVIDENCE-BACKLOG.md` (30 numbered items) for what was deliberately deferred and why.
A downstream dimension noticing a gap in an upstream classification layer is a backlog
item, not a bug to fix in passing: changing a tag or role rule to serve one consumer
risks silent regressions across every phase that shares it. Fixing one needs its own
scoped pass with a full corpus evaluation.

**Prefer false negatives.** The 9 roles and the tag vocabulary are deliberately partial
— theft and hand disruption have no role at all. The unclassified percentage is not a
metric to reduce. Write narrow rules that name themselves (`ruleId`), never broad
regexes, and never tune a rule to make a total look right.

**Verify card behavior against live Scryfall, not recollection.** The non-obvious
details in `README.md` (MDFC `cmc` placement, `not_found` echoing identifiers, name
canonicalization, the `Grist` commander exception) were each found by fetching real
payloads and each drives code. Role/tag tests use real captured Oracle text
(`tests/fixtures/roleCards.json` via `realCard()`); use `makeCard()` from
`tests/fixtures/cards.ts` only for structural tests that don't depend on wording.

**Deferring is a real outcome.** Phases 4B.5–4B.7 investigated Card Advantage,
Efficiency, and Win-Plan Quality and rejected all three as independent dimensions
rather than forcing them in. Record the negative result and its revisit conditions.

**No unearned scores or labels.** The composite index emits no rating band, no 1-10
mapping, and no casual/high-power/cEDH label, because a cross-dimension audit found
the four scales are not ratio-comparable. Scorers disclose their own limitations
per-deck. Do not add a calibrated-sounding output without the calibration.

**Phase 5A calibration pilot** (`src/eval/pilot/`) must stay blind: rater worksheets
are generated without ever reading model scores, and `npm run pilot:verify-blind`
audits that via git commit times before labels may be joined to model output. If it
fails, the comparison is circular and must be refused, not caveated.

## Extending

New features are a new pure domain module plus an optional key on `DeckProfile`; no
interfaces or registries were built in advance. `Card.scryfallJson` retains the full
raw payload so most features need no migration. `Deck.rawText` means any deck can be
recomputed; `Deck.profile` is a cache, never the source of truth.

An invalid deck is **not** an HTTP error: `200` with populated `validation.issues[]`
*and* the metrics, so the UI can show both.

LLM analysis, if added, goes in `infra/llm/` behind a separate
`POST /api/decks/[id]/analysis` reading the persisted deck — deliberately not in
`importDeck`, because keeping the import path deterministic is the point.

## Notes

- Prisma 7: `prisma-client` generator with mandatory `output`, connection URL in
  `prisma.config.ts` (not `schema.prisma`), explicit `@prisma/adapter-pg`, and no
  runtime `.env` loading — hence `dotenv/config` in `infra/db/prisma.ts`.
- `phase-*-claude-instructions.md`, `corpus/decks/`, `corpus/bundles/`, and
  `user_curated_decks/` are gitignored working data, not repository content.
- `AGENTS.md` and this file's `@AGENTS.md` import are re-created by `next dev`.
