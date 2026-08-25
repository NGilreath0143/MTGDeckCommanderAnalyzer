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

## 12. Animate Dead does not carry the `reanimation` tag

**Found by:** Phase 3A `graveyard_recursion` repair
**Affects:** Phase 3A `tags.ts`, `reanimates` rule

Animate Dead reads "Enchant creature card in a graveyard" on one line and
"Return enchanted creature card to the battlefield" on another. The
`reanimation` rule looks for a graveyard reference inside the returning clause,
so no clause ever matches and the card carries only `aura`.

Deliberately NOT fixed during the `graveyard_recursion` repair: widening an
unrelated rule mid-repair is how precision regressions get introduced. The
umbrella tag covers Animate Dead for recovery purposes, so nothing downstream
is currently blocked.

If revisited, the fix is cross-clause subject attribution for Auras that
enchant a card in a graveyard, evaluated against the full corpus.

## 13. `reanimator` archetype is a hybrid and may warrant a split

**Found by:** Phase 4B.4 inspection, confirmed by the `graveyard_recursion` repair
**Affects:** Phase 3C `archetypes.ts`, `PRIMARY_SUPPORT_TAGS`

The archetype anchors on nonland reanimation (>= 3), which is creature-specific,
but its density term already scores `graveyard_payoff`, and the real fixture is
named `graveyard-recursion-99`. It currently represents a hybrid of **creature
reanimation + broader graveyard value**.

Recommendation is to **split rather than rename**:

- `reanimator` — cheat large creatures onto the battlefield
- `graveyard_value` / `graveyard_recursion` — Muldrotha, Regrowth, Eternal
  Witness, Praetor's Counsel

These are genuinely different plans that share a zone; renaming would blur them.
Not urgent, and deliberately not done during the vocabulary repair.

## 14. Several archetypes have no recovery vocabulary

**Found by:** Phase 4B.4 (Resilience)
**Affects:** Phase 3A tag coverage

`artifacts`, `tokens`, `go_wide`, `enchantress`, `aura_voltron`, `superfriends`,
`voltron`, `counters` and `proliferate` have no tag expressing "restore a lost
resource", so their Recovery component is 0 by construction rather than by
measurement. Three of nine real decks score exactly 0.00.

This is accepted, not a defect: those archetypes genuinely rebuild by generating
fresh resources, which Weakest-Link Engine Redundancy already measures, and
counting generation as recovery credited the same engine cards twice. A deck can
still be resilient through Protection and Redundancy.

If revisited, it needs tags for genuine restoration in those families (returning
a destroyed Equipment, rebuilding a swept board from exile) rather than reusing
generation tags.

## 15. Commander backup cannot distinguish incidental from central

**Found by:** Phase 4B.4 (Resilience)
**Affects:** `commanderEngine.commanderPrimaryTags`

`commander-engine-zero-backup` (Purphoros, a genuine engine) and
`commander-not-relevant` (Bruenor, one incidental `voltron` tag) both score 0.00
with status `applicable`. Existing evidence cannot separate them.

Related to item 2 (`commanderAccess` in Consistency). Backup also counts
tag-level alternatives rather than true functional substitutability: a card
sharing a tag may not actually replace what the commander does.

Removing the command-zone floor limited the consequence — the ambiguity now
costs 0 points rather than inflating both cases by 6 — but the distinction
remains underivable.

## 16. Positive non-draw card acquisition is unrecognised

**Found by:** Phase 4B.5 investigation
**Affects:** Phase 2 `card_advantage` role

`Necropotence` reads "Pay 1 life: Exile the top card of your library face down.
Put that card into your hand..." — it never uses the word "draw", so no
`card_advantage` rule matches. It is one of the strongest card-advantage
engines in the format.

Fixing this requires a general rule for library-or-exile-to-hand acquisition,
carefully separated from selection and from impulse access. Deliberately out of
scope for the 4B.2.1 precision pass, which removes demonstrated false positives
rather than expanding recognition.

## 17. "Target player draws" subject semantics

**Found by:** Phase 4B.5 investigation
**Affects:** Phase 2 `yourMaxDraw`

`Sign in Blood` reads "Target player draws two cards and loses 2 life". The
subject guard correctly rejects a named non-you drawer, so the card gets no
`card_advantage` role even though you are almost always the target.

A repair would need to distinguish "target player" used as a self-targeting
convenience from genuinely symmetric or opponent-directed draw. Not attempted.

## 18. `efficient_card_advantage` conflates three properties

**Found by:** Phase 4B.5 investigation
**Affects:** Phase 4A `powerCards.ts` curated list (14 cards)

The list mixes mana efficiency (Night's Whisper, Sign in Blood, Painful
Truths), repeatability (Rhystic Study, Mystic Remora, Esper Sentinel) and raw
magnitude (Ad Nauseam, Necropotence). It also silently compensates for items 16
and 17: Necropotence and Sign in Blood are curated as efficient card advantage
while carrying no `card_advantage` role at all.

Cleaning it up means first fixing the two false negatives, then deciding which
single property "efficient" should name. Frozen for now.

## 19. Phase 4B.5 Resource Advantage — investigated and deferred

**Status:** CLOSED, not unfinished.

A full evidence investigation concluded that Resource Advantage cannot measure
anything independent of `Consistency.cardFlow` with available evidence:

- every candidate magnitude signal derives from `yourMaxDraw`, which the
  `card_advantage` role already thresholds and cardFlow already consumes;
- non-card resources have no separate home — Treasure generation is classified
  as `ramp` and routes to Speed, where it scores 0 on all nine real decks;
- extra land drops, permanent copying and commander resource engines have no
  deterministic evidence at all.

The genuine findings of that investigation were *corrections to Consistency's
inputs* (this backlog's items 16-18 and the 4B.2.1 precision repair), not the
basis for a fifth dimension. Reopening it would require new upstream vocabulary
for non-card resources, not a scoring pass.

## 20. One-shot self-replacing card-flow evidence

**Found by:** Phase 4B.2.1 (Card Advantage precision repair)
**Affects:** Phase 2 `card_advantage` role → Consistency `cardFlow`

The `repeatable_card_advantage` precision repair correctly removes
self-consuming draw permanents such as Mind Stone and the Spellbomb family from
repeatable engine evidence.

However, these cards may still provide legitimate one-shot card flow by
replacing themselves. The current `card_advantage` role does not represent this
semantic family, so cards such as Mind Stone can fall from repeatable credit to
**zero** cardFlow credit rather than to a lower one-shot tier.

Do not restore `repeatable_card_advantage` credit to compensate.

Future investigation should determine whether self-replacing/cantrip effects
require a distinct one-shot card-flow signal. Such a pass would need to
separate four semantic families the current model collapses into two:

- **repeatable card advantage** — Rhystic Study, Phyrexian Arena
- **one-shot card advantage** — Divination, Harmonize (net positive, once)
- **card replacement / cantripping** — Mind Stone, Spellbombs, Ponder
  (replaces itself, no net gain)
- **card selection** — Brainstorm, Sensei's Divining Top (changes which cards,
  not how many)

Today only the first and last have their own signal.

## 21. No deterministic per-archetype primary-support cost baseline

**Found by:** Phase 4B.6 (Efficiency audit)
**Affects:** any cost-based metric over `PRIMARY_SUPPORT_TAGS`

Measured corpus-wide, the average mana value of each archetype's support pool
spans **1.16 MV**: voltron 2.63, aura_voltron 2.66, enchantress 2.68 at one end;
tokens 3.67, go_wide 3.72, reanimator 3.76, spellslinger 3.78 at the other.

Across the nine real fixtures the total observed spread in support cost is only
1.51 MV, so **most of it is archetype identity rather than deck quality**. An
absolute "cheap is efficient" threshold would systematically reward Voltron and
Enchantress and penalise Spellslinger and Reanimator regardless of how well any
individual deck is built.

Normalising against a per-archetype baseline reorders the nine decks almost
completely — graveyard-recursion moves from 2nd-cheapest to best, and
voltron-equipment from mid-field to worst. That baseline does not exist in the
codebase; it was computed ad hoc from the bulk corpus during the audit.

Seam: a derived cost constant per `PRIMARY_SUPPORT_TAGS` entry, or an
archetype-relative normaliser in Phase 3C. Fourteen hand-entered constants from
a single sweep would not be defensible.

## 22. Cost reduction is not quantitatively joined to card cost

**Found by:** Phase 4B.6 (Efficiency audit)
**Affects:** Phase 3A `spell_cost_reduction` tag, Phase 4A curve evidence

`Mizzix of the Izmagnus` carries `spell_cost_reduction`, but nothing anywhere
quantifies **how much** it reduces, or joins that reduction to the mana values
of the cards it discounts. A deck whose commander halves its effective curve is
indistinguishable from one that merely mentions cost reduction.

This is why the "cost-reduction commander" case is unmeasurable: the evidence
establishes that reduction exists, never its magnitude.

Seam: a Phase 4A evidence field pairing a reduction amount with the card class
it applies to.

## 23. No deterministic leverage or impact evidence

**Found by:** Phase 4B.6 (Efficiency audit)
**Affects:** all of Phase 2/3A/4A

`Rhystic Study` and `Divination` are both mana value 3 and both carry the
`card_advantage` role. Nothing distinguishes the game impact of one from the
other. The same holds for a 6-mana engine that wins the game against a 6-mana
value creature.

This is the hard blocker for Efficiency generally: without impact evidence,
"progress purchased per resource spent" collapses into "cost", and cost alone is
archetype identity (item 21). It also limits any future Threat/Win-Plan work
that would need to separate a credible closer from a merely powerful card.

Seam: an impact/leverage classifier, which is a substantially larger modelling
question than a tag or curated list.

## 24. Phase 4B.6 Efficiency — investigated and deferred

**Status:** INVESTIGATED AND DEFERRED, not unfinished.

Existing evidence can measure **cost**, but cannot reliably measure
**primary-plan progress purchased per resource spent**.

Raw cost is strongly archetype-dependent (item 21), while the two signals that
would separate efficiency from cheapness — leverage/impact (item 23) and
quantitative cost reduction (item 22) — are not currently available. All four
`efficient_*` properties are curated name lists rather than rules, so combining
them yields a "cheap goodstuff" score already consumed by three frozen
dimensions.

The one genuinely novel join available — card `cmc` against primary-support
tags — discriminates across only a 0.49 MV band for seven of nine real decks,
and one deck's figure rests on n=2.

**Reopening condition:** revisit Efficiency only when deterministic evidence can
represent archetype-relative plan cost and/or plan leverage, rather than raw
mana cost alone.

## 25. Real-corpus combo-quality coverage gap

**Found by:** Phase 4B.7 (Win-Plan Quality audit)
**Affects:** `knownCombos.ts` `ComboResult` / `WinRequirement`, fixture coverage

`ComboResult` and `WinRequirement` provide unusually strong deterministic
win-quality evidence, distinguishing `immediate_win`, `deterministic_win`,
`infinite_mana`, `infinite_damage`, `infinite_etb`, `deck_loop` and
`major_advantage`, and marking combos that need an `additional_outlet`. That is
enough to separate a two-card deterministic kill from an infinite-mana loop
with no way to convert it.

However, **none of the nine real-deck fixtures contains a complete recognized
combo** — every one reports `completeCombos = 0`. Combo-quality semantics are
therefore validated primarily through synthetic fixtures and cannot, by
themselves, justify a deck-level Win-Plan Quality dimension.

Seam: either real fixtures containing curated combos, or a wider curated combo
list. This is fixture/coverage work, not a classifier defect.

## 26. Finisher / archetype alignment mismatches

**Found by:** Phase 4B.7 (Win-Plan Quality audit)
**Affects:** Phase 4A `alignedWinConditions` vs `PRIMARY_SUPPORT_TAGS`

Two recognised finishers fail alignment against the archetype they most
obviously serve:

- **Aurelia, the Warleader** — a curated win condition in both Voltron
  fixtures, but its tags (`attack_payoff`, `extra_combat`) do not overlap the
  Voltron support vocabulary (`voltron`, `aura`), so it is reported UNALIGNED.
- **Craterhoof Behemoth** — a curated win condition in tokens-aristocrats, but
  `go_wide_payoff` is not in the Tokens vocabulary (`token_generation`,
  `token_payoff`, `token_doubling`), so it too is UNALIGNED.

These are **evidence-vocabulary mismatches**, not scoring defects. Deliberately
not repaired: `PRIMARY_SUPPORT_TAGS` is load-bearing for win-condition
alignment, Speed's `alignmentScore`, and strategy support counting, so editing
it moves the frozen Speed dimension (demonstrated during the Phase 3A
`graveyard_recursion` work).

## 27. Phase 4B.7 Win-Plan Quality — investigated and deferred

**Status:** INVESTIGATED AND DEFERRED, not unfinished.

**Semantic target:** given that the deck assembles its plan, how decisively does
that plan convert into a win, independently of Speed, Consistency and
Resilience?

**Reason for deferral.** Existing deterministic evidence supports combo
decisiveness well, but does not support broad non-combo win-plan quality.

A candidate built only from existing NON-TIMING win evidence — aligned
finishers, complete combos, recognised win conditions — correlated **r = 0.83
with Speed and r = 0.87 with Win Speed**, indicating substantial reconstruction
of an already-frozen dimension.

Coverage is also structurally inadequate. Three of nine real decks have no
represented win plan at all (graveyard-recursion, spellslinger, superfriends),
both Voltron fixtures are severely underrepresented, and complete-combo quality
evidence fires on zero real fixtures (item 25).

**Reopening conditions:**

1. Planeswalker win representation for Superfriends.
2. Incremental-damage closing-plan evidence for Spellslinger.
3. Commander-damage lethality evidence for Voltron.
4. Finisher-requirement / support-sufficiency evidence bridging recognised
   finisher *existence* to actual closing *capability*.
5. Resolution of archetype/finisher vocabulary mismatches such as
   `go_wide_payoff` alignment for Tokens (item 26).

**Architectural warning.** Reopening Win-Plan Quality may require reconsidering
which win-quality concepts currently belong to Speed — particularly the aligned
finisher bonus and combo-quality evidence, both of which Speed consumes today.
Do not duplicate those rewards across dimensions without an explicit ownership
decision about which dimension owns each concept.

## 28. Cross-dimension scale calibration

**Found by:** Phase 4C commensurability audit
**Affects:** all four frozen dimension scales, and the Composite Power Index

The four dimension scores are **not fully ratio-comparable**, so multiplying
them (geometric mean) assumes a commensurability that has not been established.

Measured from the frozen formulas: Speed's non-combo win-speed base is capped at
`ARCHETYPE_BASE_MIN(10) + ARCHETYPE_BASE_RANGE(20) = 30` before bonuses, and the
composite is then gated by `0.75 + 0.25 * dev/100`. A non-combo deck therefore
**cannot exceed roughly 69 Speed** even with perfect development and every
finisher and combat bonus, while Consistency, Interaction and Resilience are
plain component sums any deck can fill toward 100. Only a curated complete combo
lifts Speed into the 80-100 region, and no real fixture contains one (item 25).

Consequences observed across the nine real decks: Speed's coefficient of
variation is 9.2% against 14.6-18.6% for the others, and Speed carries the
largest systematic negative log contribution to the composite (-1.30 summed,
versus Consistency +1.21). It is not merely often the minimum — it genuinely
drags hardest, because its ceiling is lower.

**Revisit when a labelled corpus exists** spanning approximately: precon /
low-power, upgraded casual, mid-power, high-power, optimised, cEDH.

That calibration pass should determine whether:

1. dimension outputs need monotonic calibration transforms;
2. the four scales can be made commensurate;
3. geometric aggregation remains appropriate after calibration;
4. overall composite bands can be established.

Until then the Composite Power Index is frozen as a provisional internal
comparative index. This is a calibration gap, **not** a defect in the geometric
mean, and must not be papered over with an unvalidated rescaling.

## 29. A fresh Git worktree is not independently runnable

**Found by:** Phase 5A.2a regression harness
**Affects:** developer tooling and any future regression comparison

A `git worktree` created at a commit cannot run the evaluators as-is. Three
dependencies are absent because they are gitignored or untracked:

- `src/generated/` — the Prisma client (`.gitignore:39`), regenerated with
  `npm run db:generate`
- `node_modules`
- environment configuration (`.env`)

This bit during the Phase 5A.2a regression check. The first baseline run
appeared to show **seven of eight frozen evaluators changing**. They had not:
every baseline process died with `ERR_MODULE_NOT_FOUND` on `@/generated`, and
the diff was comparing stack traces against real evaluator output. Symlinking
`src/generated`, `node_modules` and `.env` into the worktree produced valid
baselines, and all eight were then byte-identical.

The failure mode is dangerous because it is silent in the direction that
matters: a broken baseline manufactures apparent regressions, which invites
"fixing" code that was never wrong.

Any regression harness must prepare those dependencies and assert the baseline
actually produced output — for instance that the run emitted no error and
matched the expected line count — before treating a diff as meaningful.

Deliberately not fixed here: application behaviour is correct, and this is a
developer-tooling concern rather than a defect in the analyzer.

## 30. Silent decklist-parsing defects found only by real player lists

**Found by:** Phase 5A.2b, while validating user-authored candidate decks
**Affects:** Phase 1 `parseDecklist` (repaired)

Two defects survived every synthetic fixture and were exposed the first time
real, externally authored decklists were ingested.

**Quantity parsing corrupted X-leading card names.** The multiplier pattern
`/^(\d+)\s*[xX]\s*(.+)$/` allowed whitespace on both sides of the `x`, so
`1 Xenagos, God of Revels` matched the multiplier branch and the `[xX]` class
consumed the card's own leading X, yielding `enagos, God of Revels`. Verified
live: **27 Commander-legal cards** are affected, including `Xantid Swarm`,
`Xanthic Statue`, `Xantcha, Sleeper Agent` and `Xander's Lounge`.

**An explicit `Commander` section was never closed by a blank line.** Section
state advanced only on an explicit header, so an export using a blank line
instead of a `Deck` header — the MTGO/Arena convention — left the section set
to `commander` for the remainder of the file: 99 commanders, one
TOO_MANY_COMMANDERS error and roughly 60 spurious INVALID_COMMANDER errors.

Both are now repaired with regression coverage. Recorded because the *class*
of defect matters more than the instances:

- both were **silent in the corrupting direction**. The X bug produced no parse
  error and no warning; the fabricated name simply failed lookup later, where
  it read as bad source data rather than a parser fault. It was in fact
  initially misdiagnosed that way.
- the nine hand-built fixture decklists contain no X-leading card and no
  blank-line sectioning, so every frozen evaluator output was byte-identical
  before and after. **The fixture corpus could not have caught either bug.**

Implication for future ingestion work: synthetic fixtures validate the parser
against formats we already thought of. Externally sourced lists are the only
thing that tests it against formats we did not.

