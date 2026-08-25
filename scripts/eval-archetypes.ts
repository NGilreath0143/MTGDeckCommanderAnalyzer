/**
 * Deck-level archetype and theme inference diagnostics.
 *
 * DEVELOPER SCRIPT — never part of a request path. Informational only; it
 * never exits non-zero, because a surprising inference is something to review
 * semantically rather than a build failure.
 *
 * Every inference prints its full evidence chain, including why a failed
 * anchor blocked it. Nothing is hidden behind an aggregate score.
 *
 *   npx tsx scripts/eval-archetypes.ts [deck.txt ...] [--all]
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { composeDeck } from '@/domain/buildProfile';
import { parseDecklist } from '@/domain/parseDecklist';
import { analyzeDeckStrategy } from '@/domain/strategy';
import { inferDeckArchetypes } from '@/domain/archetypes';
import { resolveCards } from '@/pipeline/resolveCards';
import { cardRepo } from '@/infra/db/cardRepo';
import { createScryfallClient } from '@/infra/scryfall/client';

const DECK_DIR = 'tests/fixtures/decklists';
const showAll = process.argv.includes('--all');

const args = process.argv.slice(2).filter((a) => a.endsWith('.txt'));
const deckFiles =
  args.length > 0
    ? args
    : readdirSync(DECK_DIR)
        .filter((f) => f.endsWith('.txt'))
        .map((f) => join(DECK_DIR, f));

const scryfall = createScryfallClient();

for (const file of deckFiles) {
  const parsed = parseDecklist(readFileSync(file, 'utf8'));
  const names = [...new Set(parsed.entries.map((e) => e.name))];
  const { byName, unresolvedNames } = await resolveCards(names, { cardRepo, scryfall });
  const { composition } = composeDeck(parsed, byName);

  const strategy = analyzeDeckStrategy(composition);
  const archetypes = inferDeckArchetypes(composition, strategy);

  console.log(`\n${'='.repeat(78)}`);
  console.log(`DECK: ${file}`);
  console.log(`commanders: ${composition.commanders.map((c) => c.name).join(' + ') || '(none)'}`);
  if (unresolvedNames.length) console.log(`unresolved: ${unresolvedNames.join(', ')}`);
  console.log('='.repeat(78));

  // Phase 3B context, so 3C results can be read against the signals.
  console.log('\n--- phase 3B signals (context) ---');
  const topSignals = [...strategy.signals].sort((a, b) => b.score - a.score).slice(0, 5);
  console.log(`  ${topSignals.map((s) => `${s.strategy}=${s.score.toFixed(1)}`).join('  ')}`);

  const satisfied = archetypes.inferences.filter((i) => i.anchorSatisfied);
  const blocked = archetypes.inferences.filter((i) => !i.anchorSatisfied);

  console.log('\n--- inferences (anchor satisfied) ---');
  if (satisfied.length === 0) console.log('  (none)');
  console.log(
    satisfied.length
      ? `  ${'inference'.padEnd(14)} ${'kind'.padEnd(10)} ${'score'.padStart(6)}  confidence`
      : '',
  );
  for (const i of [...satisfied].sort((a, b) => b.score - a.score)) {
    const parent = i.parent ? `  (parent: ${i.parent})` : '';
    console.log(
      `  ${i.archetype.padEnd(14)} ${i.kind.padEnd(10)} ${i.score.toFixed(2).padStart(6)}  ${i.confidence}${parent}`,
    );
  }

  console.log('\n--- blocked by missing anchor ---');
  console.log(`  ${blocked.map((i) => i.archetype).join(', ') || '(none)'}`);

  // Full evidence for satisfied inferences, and for blocked ones with --all.
  const detailed = showAll ? archetypes.inferences : satisfied;
  for (const i of [...detailed].sort((a, b) => b.score - a.score)) {
    console.log(
      `\n--- ${i.archetype.toUpperCase()} — ${i.score.toFixed(2)} (${i.confidence}) ` +
        `[${i.kind}${i.parent ? `, parent=${i.parent}` : ''}] ` +
        `anchorSatisfied=${i.anchorSatisfied} ---`,
    );
    for (const e of i.evidence) {
      const value = e.value === undefined ? '' : ` = ${String(e.value)}`;
      const contribution =
        e.contribution === undefined ? '' : `   (+${e.contribution.toFixed(2)})`;
      console.log(`    ${e.id.padEnd(34)} ${e.description}${value}${contribution}`);
    }
  }
}
