import { assertBundleIsBlind } from './blindness';
import type { DeckId, RaterBundle } from './types';

/**
 * Render one rater's self-contained markdown bundle. Pure.
 *
 * One file per rater so the work can be done offline in a single sitting and
 * returned as a single artifact — that removes most of the coordination cost,
 * which is the dominant burden at this scale.
 *
 * The rendered text is passed through `assertBundleIsBlind` before it is
 * returned, so a leak fails generation rather than surviving to a rater.
 */

/**
 * The evaluator-facing definition of power.
 *
 * Worded entirely around OUTCOMES — "threaten to win", "stalling", "stop
 * opponents" — and never around mechanisms. It does not mention any dimension,
 * component weight, or count. That independence is what lets disagreement
 * between these labels and the model reveal a model defect rather than an
 * echo.
 */
export const POWER_DEFINITION = `How likely is this deck to win a four-player game against three
opponents playing decks of deliberately high quality?

Consider how early it can genuinely threaten to win, how often it does what it
is built to do rather than stalling, how well it can stop opponents from
winning first, and how well it keeps going after opponents remove its key
pieces.

A deck that only wins when unopposed is weaker than its raw ceiling suggests.`;

const RUBRIC_PROMPTS: readonly { field: string; prompt: string; scale: string }[] = [
  { field: 'earliestWinTurn', prompt: 'Earliest realistic turn this deck could win, with good draws', scale: 'turn number' },
  { field: 'typicalWinTurn', prompt: 'The turn it usually threatens to win', scale: 'turn number' },
  { field: 'freeInteractionCount', prompt: 'Cards it can cast without paying mana to answer an opponent', scale: 'count' },
  { field: 'canStopAWin', prompt: "Could it stop another deck's win attempt?", scale: '0 never - 4 reliably' },
  { field: 'recoversFromWipe', prompt: 'Could it rebuild after its board is wiped?', scale: '0 never - 4 easily' },
  { field: 'winPlanCardsNeeded', prompt: 'How many cards must come together for its main win?', scale: 'count' },
  { field: 'deterministicComboPresent', prompt: 'Does it contain a combo that just wins once assembled?', scale: 'true / false' },
  { field: 'commanderDependence', prompt: 'How much does the plan depend on the commander?', scale: '0 ignores it - 4 collapses without it' },
  { field: 'selfConfidence', prompt: 'How confident are you in your own judgment of this deck?', scale: '1 guessing - 5 certain' },
];

export interface DeckForBundle {
  id: DeckId;
  /** Raw decklist text. Must not contain curator notes. */
  decklist: string;
}

/**
 * Build the markdown a rater works from.
 *
 * Throws if the result would leak model information, so a mistake in the deck
 * data or prompts cannot reach a rater silently.
 */
export function renderRaterBundle(
  bundle: RaterBundle,
  decks: readonly DeckForBundle[],
): string {
  const byId = new Map(decks.map((d) => [d.id, d]));
  const lines: string[] = [];

  lines.push(`# Deck rating worksheet — rater ${bundle.raterId}`);
  lines.push('');
  lines.push('## What to judge');
  lines.push('');
  lines.push(POWER_DEFINITION);
  lines.push('');
  lines.push('## How to work through this');
  lines.push('');
  lines.push('1. Fill in the rubric for every deck in Part A, in the order given.');
  lines.push('2. Only then do the comparisons in Part B.');
  lines.push('3. Note roughly how many minutes each deck took.');
  lines.push('');
  lines.push('Deck names are deliberately meaningless. Judge only the list.');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('# Part A — rubric per deck');

  for (const id of bundle.deckOrder) {
    const deck = byId.get(id);
    if (!deck) throw new Error(`bundle references unknown deck: ${id}`);
    lines.push('');
    lines.push(`## Deck ${id}`);
    lines.push('');
    lines.push('```');
    lines.push(deck.decklist.trim());
    lines.push('```');
    lines.push('');
    lines.push(`| # | question | scale | your answer |`);
    lines.push(`|---|---|---|---|`);
    RUBRIC_PROMPTS.forEach((r, i) => {
      lines.push(`| ${i + 1} | ${r.prompt} | ${r.scale} | |`);
    });
    lines.push('');
    lines.push('Minutes spent: ');
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('# Part B — comparisons');
  lines.push('');
  lines.push('For each pair, mark which deck is stronger by the definition above.');
  lines.push('Write `tie` if they are genuinely too close to call — that is a real');
  lines.push('answer, not a missing one.');
  lines.push('');
  lines.push('| # | deck A | deck B | stronger (A / B / tie) |');
  lines.push('|---|---|---|---|');
  bundle.pairs.forEach((p, i) => {
    lines.push(`| ${i + 1} | ${p.a} | ${p.b} | |`);
  });
  lines.push('');

  const text = lines.join('\n');
  assertBundleIsBlind(text);
  return text;
}
