/**
 * RESILIENCE dimension diagnostics.
 *
 * DEVELOPER SCRIPT — never part of a request path. Informational only.
 *
 *   npx tsx scripts/eval-resilience.ts [--real] [--synthetic]
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { composeDeck } from '@/domain/buildProfile';
import { parseDecklist } from '@/domain/parseDecklist';
import { analyzeDeckStrategy } from '@/domain/strategy';
import { inferDeckArchetypes } from '@/domain/archetypes';
import { extractDeckPowerEvidence } from '@/domain/powerEvidence';
import { scoreResilience, type ResilienceDimension } from '@/domain/resilience';
import { resolveCards } from '@/pipeline/resolveCards';
import { cardRepo } from '@/infra/db/cardRepo';
import { createScryfallClient } from '@/infra/scryfall/client';
import { SYNTHETIC_RESILIENCE_DECKS } from '../tests/fixtures/resilience/syntheticDecks';
import type { DeckComposition } from '@/domain/types';

const scryfall = createScryfallClient();
const onlyReal = process.argv.includes('--real');
const onlySynthetic = process.argv.includes('--synthetic');

function resilienceFor(composition: DeckComposition): ResilienceDimension {
  const strategy = analyzeDeckStrategy(composition);
  const archetypes = inferDeckArchetypes(composition, strategy);
  const evidence = extractDeckPowerEvidence(composition, strategy, archetypes);
  return scoreResilience(composition, evidence, archetypes);
}

function report(label: string, description: string, r: ResilienceDimension): void {
  console.log(`\n${'='.repeat(78)}`);
  console.log(label);
  if (description) console.log(`  ${description}`);
  console.log('='.repeat(78));
  console.log(`RESILIENCE  ${r.score.toFixed(2)}  (${r.rating})`);

  const p = r.protection.raw;
  console.log(`\nPROTECTION  ${r.protection.score.toFixed(2)} / ${r.protection.max}`);
  console.log(`  raw=${p.totalProtection}  efficient=${p.efficientProtection}  ordinary=${p.ordinaryProtection}  pool=${p.weightedPool}`);

  const rec = r.recovery;
  console.log(`\nRECOVERY / REBUILD  ${rec.score.toFixed(2)} / ${rec.max}`);
  console.log(`  archetype=${rec.raw.primaryArchetype}  vocabulary=[${rec.raw.vocabulary}]`);
  console.log(`  relevant=${rec.raw.relevant}  generic=${rec.raw.generic}  pool=${rec.raw.weightedPool}`);
  console.log(`  RELEVANT: ${rec.relevantCards.slice(0, 12).join(', ') || '(none)'}`);
  console.log(`  GENERIC : ${rec.genericCards.slice(0, 12).join(', ') || '(none)'}`);

  console.log(`\nWEAKEST LINK  ${r.redundancy.score.toFixed(2)} / ${r.redundancy.max}`);
  if (r.redundancy.functions.length === 0) console.log('  (no functional model for this archetype)');
  for (const f of r.redundancy.functions) {
    const marker = f.support === r.redundancy.minimumSupport ? ' <= MIN' : '';
    console.log(`  ${f.id.padEnd(36)} support=${String(f.support).padStart(3)}${marker}`);
  }
  console.log(`  minimumSupport=${r.redundancy.minimumSupport}`);

  const c = r.commanderBackup;
  console.log(`\nCOMMANDER BACKUP  ${c.status === 'applicable' ? `${c.score.toFixed(2)} / ${c.max}` : 'UNAVAILABLE'}`);
  console.log(`  status=${c.status}`);
  console.log(`  commanderPrimaryTags=[${c.commanderPrimaryTags.join(',') || '-'}]`);
  console.log(`  backupByTag=${Object.entries(c.backupByTag).map(([t, n]) => `${t}=${n}`).join(' ') || '(none)'}`);
  console.log(`  minimumBackup=${c.minimumBackup}  contributes=${c.score.toFixed(2)}`);

  console.log('\nLIMITATIONS');
  for (const l of r.limitations) console.log(`  - ${l}`);
}

const ranking: { label: string; r: ResilienceDimension }[] = [];

if (!onlySynthetic) {
  const dir = 'tests/fixtures/decklists';
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.txt'))) {
    const parsed = parseDecklist(readFileSync(join(dir, file), 'utf8'));
    const names = [...new Set(parsed.entries.map((e) => e.name))];
    const { byName } = await resolveCards(names, { cardRepo, scryfall });
    const { composition } = composeDeck(parsed, byName);
    const r = resilienceFor(composition);
    report(`REAL DECK: ${file}`, '', r);
    ranking.push({ label: file.replace('.txt', ''), r });
  }
}

if (!onlyReal) {
  for (const deck of SYNTHETIC_RESILIENCE_DECKS) {
    const r = resilienceFor(deck.composition);
    report(`SYNTHETIC: ${deck.id}`, deck.description, r);
    ranking.push({ label: `synth:${deck.id}`, r });
  }
}

console.log(`\n${'='.repeat(78)}`);
console.log('RANKING (all evaluated cases)');
console.log('='.repeat(78));
console.log(
  `  ${'case'.padEnd(36)} ${'total'.padStart(6)} ${'recov'.padStart(6)} ${'prot'.padStart(6)}` +
    ` ${'weak'.padStart(6)} ${'cmd'.padStart(6)} ${'cmdStatus'.padStart(14)}  rating`,
);
for (const x of [...ranking].sort((a, b) => b.r.score - a.r.score)) {
  const r = x.r;
  console.log(
    `  ${x.label.padEnd(36)} ${r.score.toFixed(2).padStart(6)} ${r.recovery.score.toFixed(1).padStart(6)}` +
      ` ${r.protection.score.toFixed(1).padStart(6)} ${r.redundancy.score.toFixed(1).padStart(6)}` +
      ` ${r.commanderBackup.score.toFixed(1).padStart(6)} ${r.commanderBackup.status.padStart(14)}  ${r.rating}`,
  );
}
