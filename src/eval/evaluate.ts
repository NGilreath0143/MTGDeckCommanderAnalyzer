import { classifyCardRoles } from '@/domain/roles';
import { CARD_ROLES, type CardRole, type ResolvedCard } from '@/domain/types';

/**
 * DEVELOPER TOOLING ONLY (see bulkCards.ts). Pure: no I/O, so it is unit
 * testable and safe to call from scripts or tests.
 *
 * Golden cases use PARTIAL assertions:
 *   - `expect`  roles MUST be present
 *   - `exclude` roles MUST be absent
 *   - any other role is UNSPECIFIED and never fails the case
 *
 * That matters because roles are multi-valued and the nine roles are
 * intentionally incomplete: a case asserting `ramp` should not break when a
 * card legitimately also earns `interaction`.
 */

export interface GoldenCase {
  /** Canonical Scryfall card name; the case's identity. */
  name: string;
  /** Roles that must be present. */
  expect: CardRole[];
  /** Roles that must be absent. */
  exclude: CardRole[];
  /** Why this case exists — kept in output so failures are self-explaining. */
  note?: string;
}

export interface CaseResult {
  name: string;
  /** Roles the classifier actually produced. */
  actual: CardRole[];
  /** Rule IDs behind those roles, for auditing a failure. */
  ruleIds: string[];
  /** Asserted-present roles that were found. */
  correct: CardRole[];
  /** Asserted-present roles that were missing. */
  missing: CardRole[];
  /** Asserted-absent roles that appeared anyway. */
  unexpected: CardRole[];
  /** Roles produced but neither asserted nor excluded. */
  unspecified: CardRole[];
  passed: boolean;
  note?: string;
}

/**
 * Per-role scores derived ONLY from explicit labels.
 *
 * Precision and recall are computed against labeled expectations and
 * exclusions, not against the whole corpus, so they describe agreement with
 * the golden set rather than a claim about overall classifier accuracy.
 */
export interface RoleScore {
  /** Labeled `expect` occurrences for this role. */
  expected: number;
  /** Labeled `exclude` occurrences for this role. */
  excluded: number;
  /** Expected and present. */
  truePositives: number;
  /** Expected but absent. */
  falseNegatives: number;
  /** Excluded but present. */
  falsePositives: number;
  /**
   * tp / (tp + fp), over labeled cases only. `null` when nothing was labeled
   * either way, since a made-up 1.0 would be misleading.
   */
  precision: number | null;
  /** tp / (tp + fn), over labeled cases only. */
  recall: number | null;
}

export interface EvalReport {
  total: number;
  passed: number;
  failed: number;
  cases: CaseResult[];
  /** Only the failures, for concise script output. */
  failures: CaseResult[];
  perRole: Record<CardRole, RoleScore>;
  /** How often each rule ID fired across the golden set. */
  perRuleId: Record<string, number>;
}

function emptyScore(): RoleScore {
  return {
    expected: 0,
    excluded: 0,
    truePositives: 0,
    falseNegatives: 0,
    falsePositives: 0,
    precision: null,
    recall: null,
  };
}

function ratio(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 1000) / 1000;
}

/** Evaluate one labeled case against the live classifier. */
export function evaluateCase(golden: GoldenCase, card: ResolvedCard): CaseResult {
  const { assignments } = classifyCardRoles(card);
  const actual = [...new Set(assignments.map((a) => a.role))];
  const actualSet = new Set(actual);

  const correct = golden.expect.filter((r) => actualSet.has(r));
  const missing = golden.expect.filter((r) => !actualSet.has(r));
  const unexpected = golden.exclude.filter((r) => actualSet.has(r));

  const labeled = new Set<CardRole>([...golden.expect, ...golden.exclude]);
  const unspecified = actual.filter((r) => !labeled.has(r));

  return {
    name: golden.name,
    actual,
    ruleIds: [...new Set(assignments.map((a) => a.ruleId))],
    correct,
    missing,
    unexpected,
    unspecified,
    // Unspecified roles deliberately do NOT affect the verdict.
    passed: missing.length === 0 && unexpected.length === 0,
    note: golden.note,
  };
}

/**
 * Evaluate a golden set.
 *
 * `resolve` maps a case name to a ResolvedCard, so callers choose the source
 * (committed fixtures, bulk corpus) without this module doing I/O.
 */
export function evaluateGoldenSet(
  cases: GoldenCase[],
  resolve: (name: string) => ResolvedCard,
): EvalReport {
  const perRole = Object.fromEntries(
    CARD_ROLES.map((r) => [r, emptyScore()]),
  ) as Record<CardRole, RoleScore>;
  const perRuleId: Record<string, number> = {};
  const results: CaseResult[] = [];

  for (const golden of cases) {
    const result = evaluateCase(golden, resolve(golden.name));
    results.push(result);

    for (const ruleId of result.ruleIds) {
      perRuleId[ruleId] = (perRuleId[ruleId] ?? 0) + 1;
    }
    for (const role of golden.expect) perRole[role].expected += 1;
    for (const role of golden.exclude) perRole[role].excluded += 1;
    for (const role of result.correct) perRole[role].truePositives += 1;
    for (const role of result.missing) perRole[role].falseNegatives += 1;
    for (const role of result.unexpected) perRole[role].falsePositives += 1;
  }

  for (const role of CARD_ROLES) {
    const s = perRole[role];
    s.precision = ratio(s.truePositives, s.truePositives + s.falsePositives);
    s.recall = ratio(s.truePositives, s.truePositives + s.falseNegatives);
  }

  const failures = results.filter((r) => !r.passed);
  return {
    total: results.length,
    passed: results.length - failures.length,
    failed: failures.length,
    cases: results,
    failures,
    perRole,
    perRuleId,
  };
}

/** Human-readable report for script output. */
export function formatReport(report: EvalReport): string {
  const lines: string[] = [];
  lines.push(`golden cases: ${report.total}  passed: ${report.passed}  failed: ${report.failed}`);

  if (report.failures.length > 0) {
    lines.push('', '=== FAILURES ===');
    for (const f of report.failures) {
      lines.push(`  ${f.name}`);
      lines.push(`      actual:   [${f.actual.join(', ') || '(none)'}]`);
      lines.push(`      ruleIds:  [${f.ruleIds.join(', ') || '(none)'}]`);
      if (f.missing.length) lines.push(`      MISSING:  ${f.missing.join(', ')}`);
      if (f.unexpected.length) lines.push(`      UNEXPECTED: ${f.unexpected.join(', ')}`);
      if (f.note) lines.push(`      note: ${f.note}`);
    }
  }

  lines.push('', '=== PER-ROLE (labeled cases only) ===');
  lines.push(
    `  ${'role'.padEnd(16)} ${'exp'.padStart(4)} ${'exc'.padStart(4)} ${'tp'.padStart(4)} ${'fn'.padStart(4)} ${'fp'.padStart(4)}  precision  recall`,
  );
  for (const role of CARD_ROLES) {
    const s = report.perRole[role];
    const p = s.precision === null ? '     n/a' : s.precision.toFixed(3).padStart(8);
    const r = s.recall === null ? '   n/a' : s.recall.toFixed(3).padStart(6);
    lines.push(
      `  ${role.padEnd(16)} ${String(s.expected).padStart(4)} ${String(s.excluded).padStart(4)} ` +
        `${String(s.truePositives).padStart(4)} ${String(s.falseNegatives).padStart(4)} ` +
        `${String(s.falsePositives).padStart(4)}  ${p}  ${r}`,
    );
  }

  lines.push('', '=== PER-RULE-ID (golden set) ===');
  for (const [id, n] of Object.entries(report.perRuleId).sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${id.padEnd(26)} ${String(n).padStart(4)}`);
  }

  return lines.join('\n');
}
