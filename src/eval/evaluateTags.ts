import { classifyCardTags } from '@/domain/tags';
import { CARD_TAGS, type CardTag, type ResolvedCard } from '@/domain/types';
import type { TagGoldenCase } from './tagGoldenSet';

/**
 * DEVELOPER TOOLING ONLY (see bulkCards.ts). Pure.
 *
 * The tag counterpart of evaluate.ts. Kept separate rather than made generic:
 * the two taxonomies are independent and a shared abstraction over
 * role/tag would obscure both for no benefit at this size.
 *
 * Partial assertions: `expect` must be present, `exclude` must be absent, and
 * unspecified tags never fail a case.
 */

export interface TagCaseResult {
  name: string;
  actual: CardTag[];
  ruleIds: string[];
  correct: CardTag[];
  missing: CardTag[];
  unexpected: CardTag[];
  unspecified: CardTag[];
  passed: boolean;
  note?: string;
}

export interface TagScore {
  expected: number;
  excluded: number;
  truePositives: number;
  falseNegatives: number;
  falsePositives: number;
  /** Over labeled cases only; null when nothing was labeled either way. */
  precision: number | null;
  recall: number | null;
}

export interface TagEvalReport {
  total: number;
  passed: number;
  failed: number;
  cases: TagCaseResult[];
  failures: TagCaseResult[];
  perTag: Record<CardTag, TagScore>;
  perRuleId: Record<string, number>;
}

function emptyScore(): TagScore {
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

function ratio(n: number, d: number): number | null {
  return d === 0 ? null : Math.round((n / d) * 1000) / 1000;
}

export function evaluateTagCase(
  golden: TagGoldenCase,
  card: ResolvedCard,
): TagCaseResult {
  const { assignments } = classifyCardTags(card);
  const actual = [...new Set(assignments.map((a) => a.tag))];
  const actualSet = new Set(actual);

  const correct = golden.expect.filter((t) => actualSet.has(t));
  const missing = golden.expect.filter((t) => !actualSet.has(t));
  const unexpected = golden.exclude.filter((t) => actualSet.has(t));
  const labeled = new Set<CardTag>([...golden.expect, ...golden.exclude]);

  return {
    name: golden.name,
    actual,
    ruleIds: [...new Set(assignments.map((a) => a.ruleId))],
    correct,
    missing,
    unexpected,
    unspecified: actual.filter((t) => !labeled.has(t)),
    passed: missing.length === 0 && unexpected.length === 0,
    note: golden.note,
  };
}

export function evaluateTagGoldenSet(
  cases: TagGoldenCase[],
  resolve: (name: string) => ResolvedCard,
): TagEvalReport {
  const perTag = Object.fromEntries(
    CARD_TAGS.map((t) => [t, emptyScore()]),
  ) as Record<CardTag, TagScore>;
  const perRuleId: Record<string, number> = {};
  const results: TagCaseResult[] = [];

  for (const golden of cases) {
    const result = evaluateTagCase(golden, resolve(golden.name));
    results.push(result);

    for (const ruleId of result.ruleIds) {
      perRuleId[ruleId] = (perRuleId[ruleId] ?? 0) + 1;
    }
    for (const t of golden.expect) perTag[t].expected += 1;
    for (const t of golden.exclude) perTag[t].excluded += 1;
    for (const t of result.correct) perTag[t].truePositives += 1;
    for (const t of result.missing) perTag[t].falseNegatives += 1;
    for (const t of result.unexpected) perTag[t].falsePositives += 1;
  }

  for (const t of CARD_TAGS) {
    const s = perTag[t];
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
    perTag,
    perRuleId,
  };
}

export function formatTagReport(report: TagEvalReport): string {
  const lines: string[] = [];
  lines.push(`tag golden cases: ${report.total}  passed: ${report.passed}  failed: ${report.failed}`);

  if (report.failures.length > 0) {
    lines.push('', '=== FAILURES ===');
    for (const f of report.failures) {
      lines.push(`  ${f.name}`);
      lines.push(`      actual:  [${f.actual.join(', ') || '(none)'}]`);
      lines.push(`      ruleIds: [${f.ruleIds.join(', ') || '(none)'}]`);
      if (f.missing.length) lines.push(`      MISSING:    ${f.missing.join(', ')}`);
      if (f.unexpected.length) lines.push(`      UNEXPECTED: ${f.unexpected.join(', ')}`);
      if (f.note) lines.push(`      note: ${f.note}`);
    }
  }

  lines.push('', '=== PER-TAG (labeled cases only) ===');
  lines.push(
    `  ${'tag'.padEnd(26)} ${'exp'.padStart(4)} ${'exc'.padStart(4)} ${'tp'.padStart(4)} ${'fn'.padStart(4)} ${'fp'.padStart(4)}  precision  recall`,
  );
  for (const t of CARD_TAGS) {
    const s = report.perTag[t];
    if (s.expected === 0 && s.excluded === 0) continue; // unlabeled: nothing to report
    const p = s.precision === null ? '     n/a' : s.precision.toFixed(3).padStart(8);
    const r = s.recall === null ? '   n/a' : s.recall.toFixed(3).padStart(6);
    lines.push(
      `  ${t.padEnd(26)} ${String(s.expected).padStart(4)} ${String(s.excluded).padStart(4)} ` +
        `${String(s.truePositives).padStart(4)} ${String(s.falseNegatives).padStart(4)} ` +
        `${String(s.falsePositives).padStart(4)}  ${p}  ${r}`,
    );
  }

  lines.push('', '=== PER-RULE-ID (tag golden set) ===');
  for (const [id, n] of Object.entries(report.perRuleId).sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${id.padEnd(30)} ${String(n).padStart(4)}`);
  }
  return lines.join('\n');
}
