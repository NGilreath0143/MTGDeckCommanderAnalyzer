/**
 * Per-card role diagnostics for fixture decks.
 *
 * DEVELOPER SCRIPT — never part of a request path. Informational only; it
 * never exits non-zero, because a surprising classification is something to
 * review semantically, not a build failure.
 *
 *   npx tsx scripts/eval-decks.ts [deck.txt ...]
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { composeDeck } from '@/domain/buildProfile';
import { parseDecklist } from '@/domain/parseDecklist';
import { analyzeDeckRoles, classifyCardRoles } from '@/domain/roles';
import { analyzeDeckTags, classifyCardTags } from '@/domain/tags';
import { CARD_ROLES, CARD_TAGS } from '@/domain/types';
import { findSuspiciousCases } from '@/eval/diagnostics';
import { resolveCards } from '@/pipeline/resolveCards';
import { cardRepo } from '@/infra/db/cardRepo';
import { createScryfallClient } from '@/infra/scryfall/client';

const DECK_DIR = 'tests/fixtures/decklists';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const deckFiles =
  args.length > 0
    ? args
    : readdirSync(DECK_DIR)
        .filter((f) => f.endsWith('.txt'))
        .map((f) => join(DECK_DIR, f));

const scryfall = createScryfallClient();

for (const file of deckFiles) {
  const text = readFileSync(file, 'utf8');
  const parsed = parseDecklist(text);
  const names = [...new Set(parsed.entries.map((e) => e.name))];
  const { byName, unresolvedNames } = await resolveCards(names, { cardRepo, scryfall });
  const { composition } = composeDeck(parsed, byName);

  console.log(`\n${'='.repeat(72)}`);
  console.log(`DECK: ${file}`);
  console.log('='.repeat(72));
  if (unresolvedNames.length > 0) {
    console.log(`unresolved: ${unresolvedNames.join(', ')}`);
  }

  const entries = [
    ...composition.commanders.map((card) => ({ card, quantity: 1, commander: true })),
    ...composition.mainboard.map((e) => ({ ...e, commander: false })),
  ];

  const noRole: string[] = [];
  console.log('\n--- classified cards ---');
  for (const { card, quantity, commander } of entries) {
    const { assignments } = classifyCardRoles(card);
    const label = `${commander ? '[CMD] ' : ''}${card.name}${quantity > 1 ? ` x${quantity}` : ''}`;
    if (assignments.length === 0) {
      noRole.push(label);
      continue;
    }
    const detail = assignments.map((a) => `${a.role}(${a.ruleId})`).join(', ');
    console.log(`  ${label.padEnd(36)} ${detail}`);
  }

  console.log(`\n--- no roles (${noRole.length}) ---`);
  for (const n of noRole) console.log(`  ${n}`);

  const profile = analyzeDeckRoles(composition);
  console.log('\n--- role totals (quantity-weighted) ---');
  for (const role of CARD_ROLES) {
    console.log(`  ${role.padEnd(16)} ${String(profile.counts[role]).padStart(4)}`);
  }

  const tagProfile = analyzeDeckTags(composition);
  const activeTags = CARD_TAGS.filter((t) => tagProfile.counts[t] > 0);
  console.log('\n--- strategy tags (quantity-weighted, nonzero only) ---');
  for (const tag of activeTags) {
    console.log(`  ${tag.padEnd(26)} ${String(tagProfile.counts[tag]).padStart(4)}`);
  }
  if (activeTags.length === 0) console.log('  (none)');

  console.log('\n--- per-card tags ---');
  for (const { card } of entries) {
    const { assignments } = classifyCardTags(card);
    if (assignments.length === 0) continue;
    const detail = assignments.map((a) => `${a.tag}(${a.ruleId})`).join(', ');
    console.log(`  ${card.name.padEnd(34)} ${detail}`);
  }

  const suspicious = entries.flatMap(({ card }) => findSuspiciousCases(card));
  if (suspicious.length > 0) {
    console.log('\n--- review signals (informational) ---');
    for (const s of suspicious) {
      console.log(`  [${s.signal}] ${s.cardName}: ${s.roles.join(', ')}`);
    }
  }
}
