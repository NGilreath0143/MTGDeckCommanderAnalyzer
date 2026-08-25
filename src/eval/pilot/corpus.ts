import type { BelievedTier, DeckMeta } from './types';

/**
 * Corpus coverage checks. Pure.
 *
 * The nine existing fixtures are all coherent, mid-power decks, which is why
 * the composite index spans only 8.47 points across them. A calibration corpus
 * that repeats that mistake would measure noise, so coverage is checked before
 * any labelling effort is spent.
 */

/** The pilot's intended tier mix: 12 decks spanning the full range. */
export const PILOT_TIER_TARGETS: Readonly<Record<BelievedTier, number>> = {
  precon: 2,
  casual: 2,
  focused: 1,
  optimized: 2,
  high_power: 2,
  cedh: 2,
  /** At least one deliberately incoherent deck, to test that the model floors. */
  incoherent: 1,
};

export interface CoverageIssue {
  kind: 'tier_shortfall' | 'tier_excess' | 'anchor_count' | 'duplicate_id' | 'id_leaks_identity';
  detail: string;
}

const PILOT_ANCHOR_TARGET = 3;

/**
 * An opaque id must not encode the commander or archetype: a rater who can
 * read "storm" or a commander name from the filename is primed before opening
 * the list. Ids are expected to look like `deck-a7f3`.
 */
const OPAQUE_ID = /^deck-[0-9a-f]{4,8}$/;

export function checkPilotCoverage(decks: readonly DeckMeta[]): CoverageIssue[] {
  const issues: CoverageIssue[] = [];

  const seen = new Set<string>();
  for (const d of decks) {
    if (seen.has(d.id)) {
      issues.push({ kind: 'duplicate_id', detail: `duplicate deck id: ${d.id}` });
    }
    seen.add(d.id);
    if (!OPAQUE_ID.test(d.id)) {
      issues.push({
        kind: 'id_leaks_identity',
        detail: `deck id "${d.id}" is not opaque; expected deck-<hex>`,
      });
    }
  }

  for (const [tier, want] of Object.entries(PILOT_TIER_TARGETS) as [BelievedTier, number][]) {
    const have = decks.filter((d) => d.believedTier === tier).length;
    if (have < want) {
      issues.push({
        kind: 'tier_shortfall',
        detail: `tier ${tier}: have ${have}, want ${want}`,
      });
    } else if (have > want) {
      issues.push({
        kind: 'tier_excess',
        detail: `tier ${tier}: have ${have}, want ${want} (not fatal, but the mix drifts)`,
      });
    }
  }

  const anchors = decks.filter((d) => d.anchor).length;
  if (anchors !== PILOT_ANCHOR_TARGET) {
    issues.push({
      kind: 'anchor_count',
      detail: `${anchors} anchor(s) marked, expected ${PILOT_ANCHOR_TARGET}`,
    });
  }

  return issues;
}

/** Total decks the pilot expects. */
export const PILOT_DECK_COUNT = Object.values(PILOT_TIER_TARGETS).reduce((a, b) => a + b, 0);
