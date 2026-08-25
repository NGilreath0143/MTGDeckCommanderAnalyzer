/**
 * INTERACTION dimension diagnostics.
 *
 * DEVELOPER SCRIPT — never part of a request path. Informational only.
 * Prints every component with the raw evidence beside it, plus the
 * discontinuity probes needed to inspect the stack presence bonus and the
 * graveyard / board-wipe diminishing-return curves.
 *
 *   npx tsx scripts/eval-interaction.ts [--real] [--synthetic] [--probes]
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { composeDeck } from '@/domain/buildProfile';
import { parseDecklist } from '@/domain/parseDecklist';
import { analyzeDeckStrategy } from '@/domain/strategy';
import { inferDeckArchetypes } from '@/domain/archetypes';
import { extractDeckPowerEvidence } from '@/domain/powerEvidence';
import { scoreInteraction, type InteractionDimension } from '@/domain/interaction';
import { resolveCards } from '@/pipeline/resolveCards';
import { cardRepo } from '@/infra/db/cardRepo';
import { createScryfallClient } from '@/infra/scryfall/client';
import { SYNTHETIC_INTERACTION_DECKS } from '../tests/fixtures/interaction/syntheticDecks';
import { realCard } from '../tests/fixtures/roleCards';
import { basicLand, makeCard } from '../tests/fixtures/cards';
import type { DeckComposition } from '@/domain/types';

const scryfall = createScryfallClient();
const onlyReal = process.argv.includes('--real');
const onlySynthetic = process.argv.includes('--synthetic');

const raw = (r: Record<string, unknown>) =>
  Object.entries(r).map(([k, v]) => `${k}=${v}`).join(' ');

function interactionFor(composition: DeckComposition): InteractionDimension {
  const strategy = analyzeDeckStrategy(composition);
  const archetypes = inferDeckArchetypes(composition, strategy);
  const evidence = extractDeckPowerEvidence(composition, strategy, archetypes);
  return scoreInteraction(composition, evidence);
}

function report(label: string, description: string, i: InteractionDimension): void {
  console.log(`\n${'='.repeat(78)}`);
  console.log(label);
  if (description) console.log(`  ${description}`);
  console.log('='.repeat(78));
  console.log(`INTERACTION  ${i.score.toFixed(2)}  (${i.rating})`);

  const line = (name: string, c: { score: number; max: number; raw: Record<string, unknown> }) =>
    console.log(
      `  ${name.padEnd(14)} ${c.score.toFixed(2).padStart(6)} / ${String(c.max).padStart(2)}   ${raw(c.raw)}`,
    );

  console.log('\nCOMPONENTS');
  line('AVAILABILITY', i.availability);
  line('EFFICIENCY', i.efficiency);
  line('COVERAGE', i.coverage);
  line('STACK', i.stack);
  line('STAX', i.stax);
  line('GRAVEYARD', i.graveyard);
  line('BOARD RESET', i.boardReset);

  console.log('\nCOVERAGE DETAIL');
  for (const c of i.coverage.categories) {
    console.log(
      `  ${c.category.padEnd(13)} ${c.covered ? 'covered ' : 'absent  '} support=${String(c.support).padStart(3)}  weight=${c.weight}`,
    );
  }

  console.log('\nLIMITATIONS / DIAGNOSTICS');
  for (const l of i.limitations) console.log(`  - ${l}`);
}

interface Row { label: string; i: InteractionDimension }
const ranking: Row[] = [];

if (!onlySynthetic) {
  const dir = 'tests/fixtures/decklists';
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.txt'))) {
    const parsed = parseDecklist(readFileSync(join(dir, file), 'utf8'));
    const names = [...new Set(parsed.entries.map((e) => e.name))];
    const { byName } = await resolveCards(names, { cardRepo, scryfall });
    const { composition } = composeDeck(parsed, byName);
    const i = interactionFor(composition);
    report(`REAL DECK: ${file}`, '', i);
    ranking.push({ label: file.replace('.txt', ''), i });
  }
}

if (!onlyReal) {
  for (const deck of SYNTHETIC_INTERACTION_DECKS) {
    const i = interactionFor(deck.composition);
    report(`SYNTHETIC: ${deck.id}`, deck.description, i);
    ranking.push({ label: `synth:${deck.id}`, i });
  }
}

console.log(`\n${'='.repeat(78)}`);
console.log('RANKING (all evaluated cases)');
console.log('='.repeat(78));
console.log(
  `  ${'case'.padEnd(36)} ${'total'.padStart(6)} ${'avail'.padStart(6)} ${'eff'.padStart(6)}` +
    ` ${'cov'.padStart(5)} ${'stack'.padStart(6)} ${'stax'.padStart(5)} ${'gy'.padStart(4)} ${'reset'.padStart(5)}  rating`,
);
for (const r of [...ranking].sort((a, b) => b.i.score - a.i.score)) {
  const i = r.i;
  console.log(
    `  ${r.label.padEnd(36)} ${i.score.toFixed(2).padStart(6)} ${i.availability.score.toFixed(1).padStart(6)}` +
      ` ${i.efficiency.score.toFixed(1).padStart(6)} ${i.coverage.score.toFixed(1).padStart(5)}` +
      ` ${i.stack.score.toFixed(1).padStart(6)} ${i.stax.score.toFixed(1).padStart(5)}` +
      ` ${i.graveyard.score.toFixed(1).padStart(4)} ${i.boardReset.score.toFixed(1).padStart(5)}  ${i.rating}`,
  );
}

// --- discontinuity probes -------------------------------------------------
const filler = (n: number) => ({
  card: makeCard({ name: 'Filler', typeLine: 'Creature — Human', cmc: 3, manaCost: '{2}{G}', oracleText: '' }),
  quantity: n,
});
const lands = (n: number) => ({ card: basicLand('Forest', 'G'), quantity: n });
const probe = (cards: string[]): DeckComposition => ({
  commanders: [],
  mainboard: [...cards.map((n) => ({ card: realCard(n), quantity: 1 })), filler(62 - cards.length), lands(37)],
});

console.log(`\n${'='.repeat(78)}`);
console.log('PROBE: stack presence discontinuity (0 -> 1 -> 2 -> 3 counterspells)');
console.log('='.repeat(78));
const COUNTERS = ['Counterspell', 'Swan Song', 'Dovin\'s Veto', 'Flusterstorm'];
let prevStack: number | null = null;
for (let n = 0; n <= 4; n++) {
  const i = interactionFor(probe(COUNTERS.slice(0, n)));
  const s = i.stack;
  const delta = prevStack === null ? '' : `  delta=${(s.score - prevStack).toFixed(2)}`;
  console.log(
    `  ${n} counters  stack=${s.score.toFixed(2).padStart(6)} / 15   presence=${s.raw.presence} depth=${s.raw.depth}  total=${i.score.toFixed(2)}${delta}`,
  );
  prevStack = s.score;
}

console.log(`\n${'='.repeat(78)}`);
console.log('PROBE: graveyard-hate progression (0 -> 1 -> 2 -> 4 -> 8)');
console.log('='.repeat(78));
const GY = ['Rest in Peace', 'Leyline of the Void', 'Relic of Progenitus', 'Nihil Spellbomb',
  'Bojuka Bog', 'Ground Seal', 'Silent Gravestone', 'Planar Void'];
for (const n of [0, 1, 2, 4, 8]) {
  const i = interactionFor(probe(GY.slice(0, n)));
  console.log(
    `  ${String(n).padStart(2)} hate   graveyard=${i.graveyard.score.toFixed(2).padStart(5)} / 5   ` +
      `avail=${i.availability.score.toFixed(2).padStart(6)}  total=${i.score.toFixed(2)}`,
  );
}

console.log(`\n${'='.repeat(78)}`);
console.log('PROBE: board-wipe progression (0 -> 1 -> 2 -> 4 -> 8)');
console.log('='.repeat(78));
const WIPES = ['Damnation', 'Blasphemous Act', 'Cleansing Nova', 'Fumigate',
  'Languish', 'Pyroclasm', 'Austere Command', 'Hour of Revelation'];
for (const n of [0, 1, 2, 4, 8]) {
  const i = interactionFor(probe(WIPES.slice(0, n)));
  console.log(
    `  ${String(n).padStart(2)} wipes  reset=${i.boardReset.score.toFixed(2).padStart(5)} / 5   ` +
      `avail=${i.availability.score.toFixed(2).padStart(6)}  total=${i.score.toFixed(2)}`,
  );
}
