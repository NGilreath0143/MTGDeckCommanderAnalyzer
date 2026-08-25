/**
 * SPEED dimension diagnostics.
 *
 * DEVELOPER SCRIPT — never part of a request path. Informational only.
 * Prints every component with the raw evidence beside it, so any score can be
 * explained. Produces no turn-to-win estimate.
 *
 *   npx tsx scripts/eval-speed.ts [--real] [--synthetic]
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { composeDeck } from '@/domain/buildProfile';
import { parseDecklist } from '@/domain/parseDecklist';
import { analyzeDeckStrategy } from '@/domain/strategy';
import { inferDeckArchetypes } from '@/domain/archetypes';
import { extractDeckPowerEvidence } from '@/domain/powerEvidence';
import { scoreSpeed, type SpeedDimension } from '@/domain/speed';
import { resolveCards } from '@/pipeline/resolveCards';
import { cardRepo } from '@/infra/db/cardRepo';
import { createScryfallClient } from '@/infra/scryfall/client';
import { SYNTHETIC_SPEED_DECKS } from '../tests/fixtures/speed/syntheticDecks';
import type { DeckComposition } from '@/domain/types';

const scryfall = createScryfallClient();
const onlyReal = process.argv.includes('--real');
const onlySynthetic = process.argv.includes('--synthetic');

function report(
  label: string,
  description: string,
  s: SpeedDimension,
  tutorEvidence?: import('@/domain/tutorRelevance').TutorRelevanceEvidence,
): void {
  console.log(`\n${'='.repeat(78)}`);
  console.log(`${label}`);
  if (description) console.log(`  ${description}`);
  console.log('='.repeat(78));
  console.log(`SPEED  ${s.score.toFixed(2)}  (${s.rating})`);

  const d = s.development;
  console.log(`\nDEVELOPMENT  ${d.score.toFixed(2)}`);
  const line = (name: string, c: typeof d.acceleration) =>
    console.log(
      `  ${name.padEnd(24)} ${c.score.toFixed(2).padStart(7)} / ${String(c.max).padStart(3)}   ` +
        Object.entries(c.raw).map(([k, v]) => `${k}=${v}`).join(' '),
    );
  line('acceleration', d.acceleration);
  line('curve', d.curve);
  line('proactiveDevelopment', d.proactiveDevelopment);
  line('manaBaseFriction', d.manaBaseFriction);

  const w = s.winSpeed;
  console.log(`\nWIN SPEED  ${w.score.toFixed(2)}   best=${w.bestLine ? `${w.bestLine.kind}:${w.bestLine.id}` : '(none)'}`);
  if (w.lines.length === 0) console.log('  (no win line established)');
  for (const l of w.lines) {
    const marker = l === w.bestLine ? '*' : ' ';
    console.log(`  ${marker} [${l.kind}] ${l.id.padEnd(40)} ${l.score.toFixed(2).padStart(6)}`);
    console.log(`      ${Object.entries(l.raw).map(([k, v]) => `${k}=${v}`).join('  ')}`);
  }

  if (tutorEvidence) {
    const t = tutorEvidence;
    console.log('\nTUTOR RELEVANCE (evidence only, 0 Speed points)');
    console.log(
      `  relevantForWin=${t.relevantTutorsForWin}  relevantEfficientForWin=${t.relevantEfficientTutorsForWin}` +
        `  relevantForPrimaryEngine=${t.relevantTutorsForPrimaryEngine}  potentialOnly=${t.potentialTutorsForWin}`,
    );
    for (const tu of t.tutors) {
      const exact = (m: { cardName: string; confidence: string }[]) =>
        m.filter((x) => x.confidence === 'exact').map((x) => x.cardName);
      const potential = (m: { cardName: string; confidence: string }[]) =>
        m.filter((x) => x.confidence === 'potential').map((x) => x.cardName);
      const win = [...exact(tu.findsWinConditions), ...exact(tu.findsComboPieces)];
      const pot = [...potential(tu.findsWinConditions), ...potential(tu.findsComboPieces)];
      console.log(
        `    ${tu.tutorName.padEnd(24)} ${tu.efficient ? 'eff ' : '    '}` +
          `constraint=${tu.constraint ? (tu.constraint.unrestricted ? 'ANY' : `[${tu.constraint.types.join(',')}]`) : 'NONE'}` +
          `${tu.constraint?.unevaluatedRestriction ? ' (unevaluated)' : ''}` +
          `  win:exact=[${win.slice(0, 4).join(',')}]${pot.length ? ` potential=[${pot.slice(0, 3).join(',')}]` : ''}` +
          `  engine:exact=${exact(tu.findsPrimaryEngine).length}`,
      );
    }
    if (t.unsupportedConstraintTutors.length) {
      console.log(`    unsupported constraint semantics: ${t.unsupportedConstraintTutors.join(', ')}`);
    }
  }

  console.log('\nLIMITATIONS / DIAGNOSTICS');
  if (s.limitations.length === 0) console.log('  (none)');
  for (const lim of s.limitations) console.log(`  - ${lim}`);
}

function speedFor(composition: DeckComposition): SpeedDimension {
  const strategy = analyzeDeckStrategy(composition);
  const archetypes = inferDeckArchetypes(composition, strategy);
  const evidence = extractDeckPowerEvidence(composition, strategy, archetypes);
  return scoreSpeed(composition, evidence, archetypes);
}

const ranking: { label: string; score: number; rating: string; dev: number; win: number }[] = [];

if (!onlySynthetic) {
  const dir = 'tests/fixtures/decklists';
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.txt'))) {
    const path = join(dir, file);
    const parsed = parseDecklist(readFileSync(path, 'utf8'));
    const names = [...new Set(parsed.entries.map((e) => e.name))];
    const { byName } = await resolveCards(names, { cardRepo, scryfall });
    const { composition } = composeDeck(parsed, byName);
    const strategy = analyzeDeckStrategy(composition);
    const archetypes = inferDeckArchetypes(composition, strategy);
    const evidence = extractDeckPowerEvidence(composition, strategy, archetypes);
    const s = scoreSpeed(composition, evidence, archetypes);
    report(`REAL DECK: ${file}`, '', s, evidence.consistency.tutorRelevance);
    ranking.push({ label: file.replace('.txt', ''), score: s.score, rating: s.rating, dev: s.development.score, win: s.winSpeed.score });
  }
}

if (!onlyReal) {
  for (const deck of SYNTHETIC_SPEED_DECKS) {
    const strategy = analyzeDeckStrategy(deck.composition);
    const archetypes = inferDeckArchetypes(deck.composition, strategy);
    const evidence = extractDeckPowerEvidence(deck.composition, strategy, archetypes);
    const s = scoreSpeed(deck.composition, evidence, archetypes);
    report(`SYNTHETIC: ${deck.id}`, deck.description, s, evidence.consistency.tutorRelevance);
    ranking.push({ label: `synth:${deck.id}`, score: s.score, rating: s.rating, dev: s.development.score, win: s.winSpeed.score });
  }
}

console.log(`\n${'='.repeat(78)}`);
console.log('RANKING (all evaluated cases)');
console.log('='.repeat(78));
console.log(`  ${'case'.padEnd(40)} ${'speed'.padStart(6)} ${'dev'.padStart(6)} ${'win'.padStart(6)}  rating`);
for (const r of [...ranking].sort((a, b) => b.score - a.score)) {
  console.log(`  ${r.label.padEnd(40)} ${r.score.toFixed(2).padStart(6)} ${r.dev.toFixed(1).padStart(6)} ${r.win.toFixed(1).padStart(6)}  ${r.rating}`);
}
