/**
 * Classify the Commander-legal corpus from Scryfall bulk data.
 *
 * DEVELOPER SCRIPT — never part of a request path. Purely informational: it
 * always exits zero. In particular the unclassified percentage is NOT a metric
 * to optimize; the nine roles are intentionally incomplete, so most cards
 * having no role is expected.
 *
 *   npx tsx scripts/eval-corpus.ts [--samples 12] [--role ramp] [--rule mana-ability]
 */
import { classifyCardRoles } from '@/domain/roles';
import { CARD_ROLES, type CardRole } from '@/domain/types';
import { ensureBulkFile, streamCommanderLegalCards } from '@/eval/bulkCards';
import { findSuspiciousCases, SUSPICIOUS_SIGNAL_IDS } from '@/eval/diagnostics';

function flag(name: string, fallback: string | null = null): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
}

const sampleSize = Number.parseInt(flag('samples', '10') ?? '10', 10);
const roleFilter = flag('role') as CardRole | null;
const ruleFilter = flag('rule');

const path = await ensureBulkFile();

const roleCounts: Record<string, number> = {};
const ruleCounts: Record<string, number> = {};
const roleSamples: Record<string, string[]> = {};
const ruleSamples: Record<string, string[]> = {};
const suspiciousCounts: Record<string, number> = {};
const suspiciousSamples: Record<string, string[]> = {};
const roleComboCounts = new Map<string, number>();

let total = 0;
let noRole = 0;
const noRoleSamples: string[] = [];

for await (const card of streamCommanderLegalCards(path)) {
  total += 1;
  const { assignments } = classifyCardRoles(card);

  if (assignments.length === 0) {
    noRole += 1;
    if (noRoleSamples.length < sampleSize) noRoleSamples.push(card.name);
    continue;
  }

  const roles = [...new Set(assignments.map((a) => a.role))];
  for (const role of roles) {
    roleCounts[role] = (roleCounts[role] ?? 0) + 1;
    const samples = (roleSamples[role] ??= []);
    if (samples.length < sampleSize) samples.push(card.name);
  }
  for (const ruleId of new Set(assignments.map((a) => a.ruleId))) {
    ruleCounts[ruleId] = (ruleCounts[ruleId] ?? 0) + 1;
    const samples = (ruleSamples[ruleId] ??= []);
    if (samples.length < sampleSize) samples.push(card.name);
  }

  if (roles.length > 1) {
    const key = [...roles].sort().join(' + ');
    roleComboCounts.set(key, (roleComboCounts.get(key) ?? 0) + 1);
  }

  for (const s of findSuspiciousCases(card)) {
    suspiciousCounts[s.signal] = (suspiciousCounts[s.signal] ?? 0) + 1;
    const samples = (suspiciousSamples[s.signal] ??= []);
    if (samples.length < sampleSize) samples.push(card.name);
  }
}

const classified = total - noRole;
console.log(`Commander-legal cards: ${total}`);
console.log(`classified:            ${classified}`);
console.log(`no roles:              ${noRole} (${((noRole / total) * 100).toFixed(1)}%)`);
console.log('  (not a metric to reduce: the nine roles are intentionally incomplete)');

console.log('\n=== CARDS PER ROLE ===');
for (const role of CARD_ROLES) {
  console.log(`  ${role.padEnd(16)} ${String(roleCounts[role] ?? 0).padStart(6)}`);
}

console.log('\n=== CARDS PER RULE ID ===');
for (const [id, n] of Object.entries(ruleCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${id.padEnd(26)} ${String(n).padStart(6)}`);
}
const unfired = [...new Set(Object.keys(ruleSamples))];
console.log(`  (${unfired.length} distinct rule ids fired)`);

console.log('\n=== MOST COMMON ROLE COMBINATIONS ===');
for (const [combo, n] of [...roleComboCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`  ${String(n).padStart(6)}  ${combo}`);
}

console.log('\n=== REVIEW SIGNALS (informational, never failures) ===');
for (const signal of SUSPICIOUS_SIGNAL_IDS) {
  const n = suspiciousCounts[signal] ?? 0;
  console.log(`  ${signal.padEnd(28)} ${String(n).padStart(6)}`);
  if (n > 0) console.log(`      e.g. ${(suspiciousSamples[signal] ?? []).join(', ')}`);
}

console.log('\n=== SAMPLES FOR MANUAL INSPECTION ===');
const roleKeys = roleFilter ? [roleFilter] : CARD_ROLES;
for (const role of roleKeys) {
  console.log(`  ${role}: ${(roleSamples[role] ?? []).join(', ') || '(none)'}`);
}
if (ruleFilter) {
  console.log(`\n  rule ${ruleFilter}: ${(ruleSamples[ruleFilter] ?? []).join(', ') || '(none)'}`);
}
console.log(`\n  no roles: ${noRoleSamples.join(', ')}`);
