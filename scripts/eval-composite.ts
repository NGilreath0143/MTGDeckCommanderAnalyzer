/**
 * COMPOSITE POWER INDEX (Phase 4C) diagnostics.
 *
 * DEVELOPER SCRIPT — never part of a request path. Informational only.
 * Prints the four frozen dimension scores beside the geometric aggregate, with
 * the arithmetic mean for comparison. Emits no rating band and no power level.
 *
 *   npx tsx scripts/eval-composite.ts
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { composeDeck } from '@/domain/buildProfile';
import { parseDecklist } from '@/domain/parseDecklist';
import { analyzeDeckStrategy } from '@/domain/strategy';
import { inferDeckArchetypes } from '@/domain/archetypes';
import { extractDeckPowerEvidence } from '@/domain/powerEvidence';
import { assessCompositePower } from '@/domain/compositePower';
import { resolveCards } from '@/pipeline/resolveCards';
import { cardRepo } from '@/infra/db/cardRepo';
import { createScryfallClient } from '@/infra/scryfall/client';

const scryfall = createScryfallClient();
const dir = 'tests/fixtures/decklists';
const rows: {
  deck: string; s: number; c: number; i: number; r: number;
  geo: number; arith: number; minDim: string; minScore: number;
}[] = [];

for (const file of readdirSync(dir).filter((f) => f.endsWith('.txt'))) {
  const parsed = parseDecklist(readFileSync(join(dir, file), 'utf8'));
  const names = [...new Set(parsed.entries.map((e) => e.name))];
  const { byName } = await resolveCards(names, { cardRepo, scryfall });
  const { composition } = composeDeck(parsed, byName);
  const strategy = analyzeDeckStrategy(composition);
  const archetypes = inferDeckArchetypes(composition, strategy);
  const evidence = extractDeckPowerEvidence(composition, strategy, archetypes);
  const a = assessCompositePower(composition, evidence, archetypes);
  rows.push({
    deck: file.replace('.txt', ''),
    s: a.dimensions.speed, c: a.dimensions.consistency,
    i: a.dimensions.interaction, r: a.dimensions.resilience,
    geo: a.score, arith: a.diagnostics.arithmeticMean,
    minDim: a.diagnostics.minimumDimension, minScore: a.diagnostics.minimumScore,
  });
}

console.log('='.repeat(96));
console.log('COMPOSITE POWER INDEX — nine real fixtures');
console.log('='.repeat(96));
console.log(
  `  ${'deck'.padEnd(24)} ${'speed'.padStart(6)} ${'consis'.padStart(7)} ${'interac'.padStart(8)}` +
    ` ${'resil'.padStart(7)} | ${'COMPOSITE'.padStart(8)} ${'arith'.padStart(7)} ${'delta'.padStart(7)}  weakest`,
);
for (const x of [...rows].sort((a, b) => b.geo - a.geo)) {
  console.log(
    `  ${x.deck.padEnd(24)} ${x.s.toFixed(2).padStart(6)} ${x.c.toFixed(2).padStart(7)}` +
      ` ${x.i.toFixed(2).padStart(8)} ${x.r.toFixed(2).padStart(7)} | ${x.geo.toFixed(2).padStart(8)}` +
      ` ${x.arith.toFixed(2).padStart(7)} ${(x.geo - x.arith).toFixed(2).padStart(7)}  ${x.minDim} ${x.minScore.toFixed(2)}`,
  );
}

const geoRank = [...rows].sort((a, b) => b.geo - a.geo).map((x) => x.deck);
const arithRank = [...rows].sort((a, b) => b.arith - a.arith).map((x) => x.deck);
console.log(`\n${'='.repeat(96)}`);
console.log('RANK COMPARISON — geometric vs arithmetic (diagnostic only)');
console.log('='.repeat(96));
console.log(`  ${'deck'.padEnd(24)} ${'geo'.padStart(4)} ${'arith'.padStart(6)} ${'shift'.padStart(6)}`);
for (const deck of geoRank) {
  const g = geoRank.indexOf(deck) + 1;
  const a = arithRank.indexOf(deck) + 1;
  console.log(`  ${deck.padEnd(24)} ${String(g).padStart(4)} ${String(a).padStart(6)} ${(a - g > 0 ? '+' : '') + String(a - g)}`);
}

const geos = rows.map((x) => x.geo);
console.log(
  `\ncomposite index: min=${Math.min(...geos).toFixed(2)} max=${Math.max(...geos).toFixed(2)}` +
    ` range=${(Math.max(...geos) - Math.min(...geos)).toFixed(2)}  (no rating band emitted)`,
);
const byMin = new Map<string, number>();
for (const x of rows) byMin.set(x.minDim, (byMin.get(x.minDim) ?? 0) + 1);
console.log(`weakest-dimension frequency: ${[...byMin].map(([d, n]) => `${d}=${n}`).join('  ')}`);
