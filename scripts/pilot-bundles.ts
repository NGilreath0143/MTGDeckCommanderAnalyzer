/**
 * Generate blind rater worksheets for the Phase 5A calibration pilot.
 *
 * DEVELOPER SCRIPT. Reads the corpus, writes one markdown worksheet per rater.
 * Never reads or computes model scores — that separation is the whole point.
 *
 *   npx tsx scripts/pilot-bundles.ts --raters r1,r2,r3 [--seed 1] [--check-only]
 *
 * Expects:
 *   corpus/decks/<id>.txt        decklist text, opaque filename
 *   corpus/meta/<id>.json        DeckMeta (curator-facing; never shown to raters)
 * Writes:
 *   corpus/bundles/<rater>.md
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildRaterBundle, pilotPairs } from '@/eval/pilot/pairs';
import { describeFreezeFailure, verifyFrozenCorpus } from '@/eval/pilot/freeze';
import { renderRaterBundle, type DeckForBundle } from '@/eval/pilot/bundle';
import { checkPilotCoverage, PILOT_DECK_COUNT } from '@/eval/pilot/corpus';
import type { DeckMeta } from '@/eval/pilot/types';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const DECKS = 'corpus/decks';
const META = 'corpus/meta';
const OUT = 'corpus/bundles';

if (!existsSync(DECKS) || !existsSync(META)) {
  console.error(
    `Corpus not found. Expected ${DECKS}/<id>.txt and ${META}/<id>.json.\n` +
      'The pilot corpus has not been collected yet; this script is the tool that\n' +
      'will consume it once it exists.',
  );
  process.exit(1);
}

/*
 * Freeze integrity comes FIRST — before coverage, pair generation, rendering or
 * writing. Bundles built from a drifted corpus would silently invalidate every
 * label collected against them, and the drift would be undetectable afterwards.
 *
 * Fails closed with no bypass flag on purpose: a check that can be skipped is
 * no guarantee, and the urge to skip it peaks exactly when something has moved.
 */
const freeze = verifyFrozenCorpus();
if (!freeze.ok) {
  console.error(describeFreezeFailure(freeze));
  process.exit(1);
}
console.log(`freeze verified: corpusDigest ${freeze.corpusDigest?.slice(0, 16)}…`);

const metas: DeckMeta[] = readdirSync(META)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(META, f), 'utf8')) as DeckMeta);

console.log(`corpus: ${metas.length} deck(s) (pilot expects ${PILOT_DECK_COUNT})`);

const issues = checkPilotCoverage(metas);
if (issues.length > 0) {
  console.log('\nCOVERAGE ISSUES');
  for (const i of issues) console.log(`  [${i.kind}] ${i.detail}`);
} else {
  console.log('coverage: OK');
}

const fatal = issues.filter((i) => i.kind !== 'tier_excess');
if (fatal.length > 0) {
  console.error('\nRefusing to generate bundles while fatal coverage issues remain.');
  process.exit(1);
}
if (process.argv.includes('--check-only')) process.exit(0);

const raters = (arg('raters') ?? 'r1,r2,r3').split(',').map((r) => r.trim()).filter(Boolean);
const seed = Number(arg('seed') ?? 1);

const decks: DeckForBundle[] = metas.map((m) => {
  const path = join(DECKS, `${m.id}.txt`);
  if (!existsSync(path)) throw new Error(`missing decklist for ${m.id}: ${path}`);
  return { id: m.id, decklist: readFileSync(path, 'utf8') };
});

const deckIds = decks.map((d) => d.id);
// Complete graph at pilot scale: 66 pairs at n=12, so full connectivity is free.
const pairs = pilotPairs(deckIds);

mkdirSync(OUT, { recursive: true });
raters.forEach((raterId, index) => {
  const bundle = buildRaterBundle(raterId, deckIds, pairs, seed + index * 1000);
  // renderRaterBundle throws if the text would leak model information.
  const text = renderRaterBundle(bundle, decks);
  const out = join(OUT, `${raterId}.md`);
  writeFileSync(out, text);
  console.log(`  wrote ${out}  (${bundle.pairs.length} comparisons)`);
});

console.log(`\n${raters.length} bundle(s) written. Commit corpus/labels/ BEFORE`);
console.log('computing any model scores, then run scripts/pilot-verify-blind.ts.');
