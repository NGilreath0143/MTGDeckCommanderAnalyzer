/**
 * CONSISTENCY dimension diagnostics.
 *
 * DEVELOPER SCRIPT — never part of a request path. Informational only.
 * Prints every component with the raw evidence beside it, plus the per-function
 * support that drives functional redundancy, so any score can be explained.
 *
 *   npx tsx scripts/eval-consistency.ts [--real] [--synthetic]
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { composeDeck } from '@/domain/buildProfile';
import { parseDecklist } from '@/domain/parseDecklist';
import { analyzeDeckStrategy } from '@/domain/strategy';
import { inferDeckArchetypes } from '@/domain/archetypes';
import { extractDeckPowerEvidence } from '@/domain/powerEvidence';
import { scoreConsistency, type ConsistencyDimension } from '@/domain/consistency';
import { resolveCards } from '@/pipeline/resolveCards';
import { cardRepo } from '@/infra/db/cardRepo';
import { createScryfallClient } from '@/infra/scryfall/client';
import { SYNTHETIC_CONSISTENCY_DECKS } from '../tests/fixtures/consistency/syntheticDecks';
import type { DeckComposition } from '@/domain/types';

const scryfall = createScryfallClient();
const onlyReal = process.argv.includes('--real');
const onlySynthetic = process.argv.includes('--synthetic');

const raw = (r: Record<string, unknown>) =>
  Object.entries(r).map(([k, v]) => `${k}=${v}`).join(' ');

function report(label: string, description: string, c: ConsistencyDimension): void {
  console.log(`\n${'='.repeat(78)}`);
  console.log(label);
  if (description) console.log(`  ${description}`);
  console.log('='.repeat(78));
  console.log(`CONSISTENCY  ${c.score.toFixed(2)}  (${c.rating})`);

  const line = (name: string, comp: { score: number; max: number; raw: Record<string, unknown> }) =>
    console.log(
      `  ${name.padEnd(18)} ${comp.score.toFixed(2).padStart(6)} / ${String(comp.max).padStart(3)}   ${raw(comp.raw)}`,
    );

  console.log('\nCOMPONENTS');
  line('targetedAccess', c.targetedAccess);
  line('selection', c.selection);
  line('cardFlow', c.cardFlow);
  line('redundancy', c.redundancy);
  line('commanderAccess', c.commanderAccess);

  const r = c.redundancy;
  console.log(
    `\nFUNCTIONAL REDUNDANCY  base=${r.raw.base}  coverage=${r.requiredCoverage}` +
      `  completeness=${r.completenessMultiplier}  requiredScore=${r.raw.requiredScore}` +
      `\n  optionalSaturation=${r.optionalSaturation}  optionalCoverage=${r.optionalCoverage}` +
      `  optionalBonus=${r.optionalBonus}`,
  );
  if (r.functions.length === 0) console.log('  (no functional model for this archetype)');
  for (const f of r.functions) {
    const perTag = Object.entries(f.perTag).map(([t, n]) => `${t}:${n}`).join(' ');
    console.log(
      `  [${f.kind.padEnd(8)}] ${f.id.padEnd(34)} support=${String(f.support).padStart(3)}` +
        `  saturation=${f.saturation.toFixed(3)}  ${f.covered ? '' : 'MISSING  '}(${perTag})`,
    );
  }

  console.log('\nLIMITATIONS / DIAGNOSTICS');
  if (c.limitations.length === 0) console.log('  (none)');
  for (const lim of c.limitations) console.log(`  - ${lim}`);
}

function consistencyFor(composition: DeckComposition): ConsistencyDimension {
  const strategy = analyzeDeckStrategy(composition);
  const archetypes = inferDeckArchetypes(composition, strategy);
  const evidence = extractDeckPowerEvidence(composition, strategy, archetypes);
  return scoreConsistency(composition, evidence, archetypes);
}

interface Row {
  label: string;
  score: number;
  rating: string;
  access: number;
  sel: number;
  flow: number;
  red: number;
  cmd: number;
}
const ranking: Row[] = [];

const push = (label: string, c: ConsistencyDimension) =>
  ranking.push({
    label,
    score: c.score,
    rating: c.rating,
    access: c.targetedAccess.score,
    sel: c.selection.score,
    flow: c.cardFlow.score,
    red: c.redundancy.score,
    cmd: c.commanderAccess.score,
  });

if (!onlySynthetic) {
  const dir = 'tests/fixtures/decklists';
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.txt'))) {
    const path = join(dir, file);
    const parsed = parseDecklist(readFileSync(path, 'utf8'));
    const names = [...new Set(parsed.entries.map((e) => e.name))];
    const { byName } = await resolveCards(names, { cardRepo, scryfall });
    const { composition } = composeDeck(parsed, byName);
    const c = consistencyFor(composition);
    report(`REAL DECK: ${file}`, '', c);
    push(file.replace('.txt', ''), c);
  }
}

if (!onlyReal) {
  for (const deck of SYNTHETIC_CONSISTENCY_DECKS) {
    const c = consistencyFor(deck.composition);
    report(`SYNTHETIC: ${deck.id}`, deck.description, c);
    push(`synth:${deck.id}`, c);
  }
}

console.log(`\n${'='.repeat(78)}`);
console.log('RANKING (all evaluated cases)');
console.log('='.repeat(78));
console.log(
  `  ${'case'.padEnd(36)} ${'total'.padStart(6)} ${'acc'.padStart(6)} ${'sel'.padStart(6)}` +
    ` ${'flow'.padStart(6)} ${'red'.padStart(6)} ${'cmd'.padStart(5)}  rating`,
);
for (const r of [...ranking].sort((a, b) => b.score - a.score)) {
  console.log(
    `  ${r.label.padEnd(36)} ${r.score.toFixed(2).padStart(6)} ${r.access.toFixed(1).padStart(6)}` +
      ` ${r.sel.toFixed(1).padStart(6)} ${r.flow.toFixed(1).padStart(6)} ${r.red.toFixed(1).padStart(6)}` +
      ` ${r.cmd.toFixed(1).padStart(5)}  ${r.rating}`,
  );
}
