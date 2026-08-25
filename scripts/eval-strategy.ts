/**
 * Deck-level strategy signal diagnostics.
 *
 * DEVELOPER SCRIPT — never part of a request path. Informational only: it never
 * exits non-zero, because a surprising score is something to review
 * semantically, not a build failure.
 *
 * Every component is printed. Nothing is hidden behind one aggregate number.
 *
 *   npx tsx scripts/eval-strategy.ts [deck.txt ...] [--min 1]
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { composeDeck } from '@/domain/buildProfile';
import { parseDecklist } from '@/domain/parseDecklist';
import { analyzeDeckStrategy } from '@/domain/strategy';
import { classifyCardTags } from '@/domain/tags';
import { cardTypes } from '@/domain/cardFacts';
import { resolveCards } from '@/pipeline/resolveCards';
import { cardRepo } from '@/infra/db/cardRepo';
import { createScryfallClient } from '@/infra/scryfall/client';

const DECK_DIR = 'tests/fixtures/decklists';

function flagValue(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const parsed = Number.parseFloat(process.argv[i + 1] ?? '');
  return Number.isFinite(parsed) ? parsed : fallback;
}

const minScore = flagValue('min', 0.01);
const args = process.argv.slice(2).filter((a) => !a.startsWith('--') && a.endsWith('.txt'));
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

  console.log(`\n${'='.repeat(78)}`);
  console.log(`DECK: ${file}`);
  console.log(
    `commanders: ${composition.commanders.map((c) => c.name).join(' + ') || '(none)'}`,
  );
  const mainboardSize = composition.mainboard.reduce((s, e) => s + e.quantity, 0);
  console.log(`mainboard size: ${mainboardSize}`);
  if (unresolvedNames.length) console.log(`unresolved: ${unresolvedNames.join(', ')}`);
  console.log('='.repeat(78));

  const profile = analyzeDeckStrategy(composition);

  // Ranked summary first, so the deck's shape is visible at a glance.
  console.log('\n--- ranked signals ---');
  console.log(
    `  ${'strategy'.padEnd(14)} ${'score'.padStart(6)} ${'raw'.padStart(6)}  ${'strength'.padEnd(11)} ` +
      `${'cov'.padStart(5)} ${'str'.padStart(5)} ${'div'.padStart(5)} ${'cmd'.padStart(4)}  cap`,
  );
  for (const s of [...profile.signals].sort((a, b) => b.score - a.score)) {
    const cap = s.cap.applied ? `CAPPED@${s.cap.maximum}` : '-';
    console.log(
      `  ${s.strategy.padEnd(14)} ${s.score.toFixed(2).padStart(6)} ${s.rawScore.toFixed(2).padStart(6)}  ` +
        `${s.strength.padEnd(11)} ${s.coverageScore.toFixed(1).padStart(5)} ${s.structureScore.toFixed(1).padStart(5)} ` +
        `${s.diversityScore.toFixed(1).padStart(5)} ${String(s.commanderScore).padStart(4)}  ${cap}`,
    );
  }

  // Then full detail for every family that scored at all.
  for (const s of [...profile.signals].sort((a, b) => b.score - a.score)) {
    if (s.score < minScore) continue;
    console.log(`\n--- ${s.strategy.toUpperCase()} : ${s.score.toFixed(2)} (${s.strength}) ---`);
    console.log(`  rawScore: ${s.rawScore.toFixed(2)}`);
    console.log(
      `  components: coverage=${s.coverageScore.toFixed(2)} structure=${s.structureScore.toFixed(2)} ` +
        `diversity=${s.diversityScore.toFixed(2)} commander=${s.commanderScore}`,
    );
    console.log(
      `  coverage: participating=${s.coverage.participatingCards} ` +
        `(tagged=${s.coverage.taggedCards}, typeEvidence=${s.coverage.additionalEvidenceCards}) ` +
        `of ${s.coverage.mainboardSize}, density=${s.coverage.density.toFixed(3)}`,
    );
    console.log(`  representedTags: [${s.representedTags.join(', ') || '(none)'}]`);
    console.log(`  commanderTags:   [${s.commanderTags.join(', ') || '(none)'}]`);
    console.log(
      `  cap: applied=${s.cap.applied}` +
        (s.cap.reason ? ` reason=${s.cap.reason}` : '') +
        (s.cap.maximum !== undefined ? ` maximum=${s.cap.maximum}` : ''),
    );
    console.log('  relationships:');
    for (const r of s.structure.relationships) {
      console.log(
        `    ${r.id.padEnd(42)} raw=${String(r.rawSupport).padStart(3)} ` +
          `distinct=${String(r.distinctSupport).padStart(3)} ` +
          `score=${r.score.toFixed(2).padStart(5)}/${r.maxScore}`,
      );
    }

    // Which mainboard cards actually contributed, for manual inspection.
    const contributors: string[] = [];
    const familyTags = new Set(s.representedTags);
    for (const { card, quantity } of composition.mainboard) {
      const tags = new Set(classifyCardTags(card).assignments.map((a) => a.tag));
      const tagged = [...tags].some((t) => familyTags.has(t));
      const pwEvidence =
        s.strategy === 'planeswalkers' && cardTypes(card.typeLine).includes('Planeswalker');
      if (tagged || pwEvidence) {
        contributors.push(quantity > 1 ? `${card.name} x${quantity}` : card.name);
      }
    }
    console.log(`  participating cards (${contributors.length} distinct):`);
    if (contributors.length) console.log(`    ${contributors.join(', ')}`);
  }
}
