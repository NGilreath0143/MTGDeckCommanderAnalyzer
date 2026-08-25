/**
 * Evaluate the strategy-tag classifier against its labeled golden set.
 *
 * DEVELOPER SCRIPT — never part of a request path. Exits non-zero only for
 * violated expect/exclude assertions.
 *
 *   npx tsx scripts/eval-tags.ts [--allow-known-gaps]
 */
import { TAG_GOLDEN_SET, TAG_KNOWN_GAP_CASES } from '@/eval/tagGoldenSet';
import { evaluateTagGoldenSet, formatTagReport } from '@/eval/evaluateTags';
import { realCard } from '../tests/fixtures/roleCards';

const allowKnownGaps = process.argv.includes('--allow-known-gaps');
const knownGapNames = new Set(TAG_KNOWN_GAP_CASES.map((c) => c.name));

const report = evaluateTagGoldenSet(TAG_GOLDEN_SET, realCard);
console.log(formatTagReport(report));

const gapFailures = report.failures.filter((f) => knownGapNames.has(f.name));
const realFailures = report.failures.filter((f) => !knownGapNames.has(f.name));

console.log('');
console.log(`known gaps labeled:       ${TAG_KNOWN_GAP_CASES.length}`);
console.log(`failures from known gaps: ${gapFailures.length}`);
console.log(`unexpected failures:      ${realFailures.length}`);

const failing = allowKnownGaps ? realFailures.length : report.failed;
if (failing > 0) {
  console.error(`\nFAIL: ${failing} case(s) violated their assertions.`);
  process.exit(1);
}
console.log('\nOK: all tag assertions satisfied.');
