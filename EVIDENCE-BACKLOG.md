# Evidence & Technical Backlog

Deferred items discovered while building later phases against earlier, frozen
ones. Nothing here is a bug in the phase that found it: each is a gap in an
upstream evidence layer that a downstream dimension noticed.

**These are not to be fixed opportunistically.** A stable classification layer
should not be reopened solely to improve one downstream consumer. Each item
needs its own scoped, evaluated pass.

---

## 1. Permission-style recursion is absent from the tag vocabulary

**Found by:** Phase 4B.2 (Consistency), commander-access audit
**Affects:** Phase 3A tags → `PRIMARY_SUPPORT_TAGS` → `commanderAccess`
**Severity:** one confirmed false negative across nine real fixtures

`Muldrotha, the Gravetide` receives **0/3** matching `reanimator` primary-support
tags (`reanimation`, `graveyard_filling`, `self_mill`) and therefore scores
`commanderAccess = 0`, despite being a textbook always-available recursion
engine. Phase 2 does classify it as the `recursion` *role*; Phase 3A does not
give it a *tag*.

Cause: Muldrotha grants **permission to replay permanents from the graveyard**
("You may play a land and a permanent spell of each type from your graveyard")
rather than returning cards, which is what the `reanimation` tag matches.

Why it was not fixed in 4B.2: the phase forbids new card classification inside
the scorer, and Phase 3A is stable and shared by Phases 3B/3C/4A/4B. Changing a
tag rule to serve one dimension risks silent regressions across all of them.

If revisited, it needs a Phase 3A pass with a full corpus evaluation, checked
for false positives on cards that merely mention playing from a graveyard.

## 2. `commanderAccess` is binary

**Found by:** Phase 4B.2 (Consistency)
**Affects:** `commanderAccess` (10 points)
**Severity:** coarse, no confirmed misordering

A graded 0/1/2 model (no support / some support / central repeatable engine) was
evaluated against all nine real fixtures and **rejected as underivable** from
existing evidence:

- Tag-overlap depth is not a proxy for centrality. `Purphoros, God of the Forge`
  matches 1/3 tags and is the deck's entire engine and its recognised win
  condition; `Atraxa` also matches 1/3.
- Item 1 above means the current rule already produces a false negative that a
  graded model built on the same overlap would inherit.
- Separating "repeatable engine" from "static payoff" has no evidence seam:
  Phase 3A tags carry no repeatability signal, and Phase 4A's
  `repeatableCardAdvantageCount` covers only card draw.

The one clean discriminator is Phase 4A `win_condition` (exactly one commander,
Purphoros, carries it). Narrow, but real, if a top tier is ever wanted.

## 3. `win_condition` curated-list coverage

**Found by:** Phase 4B.1 (Speed)
**Affects:** Phase 4A `powerCards.ts`

Superfriends' planeswalker-based finishes and spellslinger's incremental damage
have no representation in the 12-card curated `win_condition` list.

## 4. Card selection is undifferentiated

**Found by:** Phase 4B.2 (Consistency)
**Affects:** Phase 4A `cardSelectionCount` → Consistency `selection` (20 points)

`Sensei's Divining Top` (repeatable) and `Ponder` (one-shot) are indistinguishable.
Consistency discloses this as a per-deck limitation whenever selection is nonzero.

## 5. X-cost mana value is invisible

**Found by:** Phase 4A
**Affects:** combo `totalPrintedManaValue`

`Walking Ballista` has printed MV 0, so X-cost combo pieces understate their
real cost.

## 6. `targetCoverage.graveyard` is structurally unusable

**Found by:** Phase 4B.3 (Interaction)
**Affects:** Phase 4A `powerEvidence.ts` interaction coverage

The coverage loop visits only cards carrying the `interaction` role, but
graveyard answers (Bojuka Bog, Tormod's Crypt, Rest in Peace) carry
`graveyard_hate` instead. The field is therefore **0 on every real fixture**,
including a deck running nine graveyard-hate cards.

Interaction works around it by deriving graveyard capability from
`graveyardHateCount`. Repairing the field upstream would let coverage treat
graveyard as an ordinary category.

## 7. `graveyardInteractionCount` duplicates `graveyardHateCount`

**Found by:** Phase 4B.3 (Interaction)
**Affects:** Phase 4A `InteractionEvidence`

Both are computed as `sum(slots, s => s.roles.has('graveyard_hate'))` and are
identical on all nine real decks. The field carries no additional information
and is unused by Interaction.

## 8. No instant-speed flag on interaction

**Found by:** Phase 4B.3 (Interaction)
**Affects:** Phase 4A `powerCards.ts`

Swords to Plowshares and Vindicate are indistinguishable on timing, so
Interaction cannot reward holding up an answer versus committing at sorcery
speed. This is a genuine gap in interaction quality measurement.

## 9. No free interaction in the real fixture corpus

**Found by:** Phase 4B.3 (Interaction)
**Affects:** fixture coverage, not a formula

`freeInteractionCount` is 0 across all nine real decks, so the 3.0 free weight
is exercised only by synthetics. Evidence scarcity rather than a defect; a
future fixture carrying Force of Will or Fierce Guardianship would exercise it.

## 10. Stax asymmetry is not modelled

**Found by:** Phase 4A, confirmed by Phase 4B.3
**Affects:** `StaxEvidence`

A symmetric prison piece and a one-sided one score identically. Interaction
caps stax at 10 and leads with breadth to limit the consequences, but a deck
built to break its own symmetry is not distinguished from one that suffers
under it.

## 11. Commander-supplied interaction is not measurable

**Found by:** Phase 4B.3 (Interaction)
**Affects:** Phase 2 roles on commanders

All nine real commanders return no interaction/board_wipe/graveyard_hate role,
so there are zero positive instances to build a signal from. Interaction omits
a commander component entirely rather than inventing a coarse boolean —
the same conclusion reached for `commanderAccess` in item 2.
