/**
 * Evaluate the classifier against the manually labeled golden set.
 *
 * DEVELOPER SCRIPT — never part of a request path.
 *
 * Exits non-zero ONLY for violated expect/exclude assertions. Known gaps are
 * listed separately so a deliberate false negative reads as a tracked gap
 * rather than a surprise.
 *
 *   npx tsx scripts/eval-golden.ts            # fail on any violation
 *   npx tsx scripts/eval-golden.ts --allow-known-gaps
 */
import { GOLDEN_SET, KNOWN_GAP_CASES } from '@/eval/goldenSet';
import { evaluateGoldenSet, formatReport } from '@/eval/evaluate';
import { realCard } from '../tests/fixtures/roleCards';

const allowKnownGaps = process.argv.includes('--allow-known-gaps');
const knownGapNames = new Set(KNOWN_GAP_CASES.map((c) => c.name));

const report = evaluateGoldenSet(GOLDEN_SET, realCard);
console.log(formatReport(report));

const gapFailures = report.failures.filter((f) => knownGapNames.has(f.name));
const realFailures = report.failures.filter((f) => !knownGapNames.has(f.name));

console.log('');
console.log(`known gaps labeled:      ${KNOWN_GAP_CASES.length}`);
console.log(`failures from known gaps: ${gapFailures.length}`);
console.log(`unexpected failures:      ${realFailures.length}`);

if (realFailures.length > 0) {
  console.log('\n=== UNEXPECTED FAILURES (not tracked gaps) ===');
  for (const f of realFailures) {
    console.log(`  ${f.name}: missing=[${f.missing.join(',')}] unexpected=[${f.unexpected.join(',')}]`);
  }
}

const failing = allowKnownGaps ? realFailures.length : report.failed;
if (failing > 0) {
  console.error(`\nFAIL: ${failing} case(s) violated their assertions.`);
  process.exit(1);
}
console.log('\nOK: all assertions satisfied.');
