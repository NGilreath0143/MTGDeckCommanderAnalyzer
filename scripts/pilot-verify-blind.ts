/**
 * Verify the calibration pilot stayed blind, using git history as the audit
 * trail.
 *
 * DEVELOPER SCRIPT. Run this BEFORE joining labels to model output. If it
 * fails, the comparison is circular and must be refused rather than reported
 * with a caveat.
 *
 *   npx tsx scripts/pilot-verify-blind.ts
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { findBlindnessViolations, verifyLabelPriority, type CommitTime } from '@/eval/pilot/blindness';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Unix seconds of the commit that last changed a path, or null if uncommitted. */
function lastCommitTime(path: string): number | null {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%ct', '--', path], {
      encoding: 'utf8',
    }).trim();
    return out ? Number(out) : null;
  } catch {
    return null;
  }
}

function trackedFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return execFileSync('git', ['ls-files', dir], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}

const labelPaths = trackedFiles('corpus/labels');
const modelPaths = trackedFiles('corpus/model');

const toTimes = (paths: string[]): CommitTime[] =>
  paths
    .map((p) => ({ path: p, committedAt: lastCommitTime(p) }))
    .filter((x): x is CommitTime => x.committedAt !== null);

const labels = toTimes(labelPaths);
const scores = toTimes(modelPaths);

console.log('='.repeat(72));
console.log('PILOT BLINDNESS VERIFICATION');
console.log('='.repeat(72));
console.log(`committed label files: ${labels.length}`);
console.log(`committed model files: ${scores.length}`);

const priority = verifyLabelPriority(labels, scores);
console.log(`\ncommit ordering: ${priority.ok ? 'OK' : 'FAILED'}`);
console.log(`  ${priority.reason}`);

// Independently re-check every distributed bundle for leaked model information.
let bundleLeaks = 0;
const bundleDir = 'corpus/bundles';
if (existsSync(bundleDir)) {
  for (const f of readdirSync(bundleDir).filter((x) => x.endsWith('.md'))) {
    const violations = findBlindnessViolations(readFileSync(join(bundleDir, f), 'utf8'));
    if (violations.length === 0) continue;
    bundleLeaks += violations.length;
    console.log(`\nBUNDLE LEAK in ${f}`);
    for (const v of violations) console.log(`  "${v.term}" in ...${v.context}...`);
  }
}
console.log(`\ndistributed bundles: ${bundleLeaks === 0 ? 'clean' : `${bundleLeaks} leak(s)`}`);

const ok = priority.ok && bundleLeaks === 0;
console.log(`\n${'='.repeat(72)}`);
console.log(ok ? 'BLIND: comparison may proceed.' : 'NOT BLIND: do not compare labels to model output.');
process.exit(ok ? 0 : 1);
