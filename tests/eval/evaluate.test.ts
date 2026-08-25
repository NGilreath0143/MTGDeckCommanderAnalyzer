import { describe, expect, it } from 'vitest';
import { evaluateCase, evaluateGoldenSet, type GoldenCase } from '@/eval/evaluate';
import { findSuspiciousCases } from '@/eval/diagnostics';
import { GOLDEN_SET } from '@/eval/goldenSet';
import { basicLand, makeCard } from '../fixtures/cards';
import { realCard } from '../fixtures/roleCards';

/** Tests for the evaluation tooling itself, not for the classifier. */

describe('evaluateCase partial assertions', () => {
  const solRing = () => realCard('Sol Ring'); // ramp(mana-ability)

  it('passes when every expected role is present', () => {
    const result = evaluateCase({ name: 'Sol Ring', expect: ['ramp'], exclude: [] }, solRing());
    expect(result.passed).toBe(true);
    expect(result.correct).toEqual(['ramp']);
    expect(result.missing).toEqual([]);
  });

  it('fails and names the missing role', () => {
    const result = evaluateCase({ name: 'Sol Ring', expect: ['tutor'], exclude: [] }, solRing());
    expect(result.passed).toBe(false);
    expect(result.missing).toEqual(['tutor']);
  });

  it('fails when an excluded role appears', () => {
    const result = evaluateCase({ name: 'Sol Ring', expect: [], exclude: ['ramp'] }, solRing());
    expect(result.passed).toBe(false);
    expect(result.unexpected).toEqual(['ramp']);
  });

  it('does NOT fail on roles that are neither expected nor excluded', () => {
    // Counterspell yields interaction + protection; assert only interaction.
    const result = evaluateCase(
      { name: 'Counterspell', expect: ['interaction'], exclude: [] },
      realCard('Counterspell'),
    );
    expect(result.passed).toBe(true);
    expect(result.unspecified).toContain('protection');
  });

  it('reports the rule IDs behind a classification', () => {
    const result = evaluateCase({ name: 'Sol Ring', expect: ['ramp'], exclude: [] }, solRing());
    expect(result.ruleIds).toEqual(['mana-ability']);
  });

  it('passes a case with no expectations and no exclusions', () => {
    const result = evaluateCase(
      { name: 'x', expect: [], exclude: [] },
      makeCard({ oracleText: '' }),
    );
    expect(result.passed).toBe(true);
  });
});

describe('evaluateGoldenSet aggregation', () => {
  const cases: GoldenCase[] = [
    { name: 'Sol Ring', expect: ['ramp'], exclude: ['tutor'] },
    { name: 'Demonic Tutor', expect: ['tutor'], exclude: ['ramp'] },
    { name: 'Cultivate', expect: ['ramp'], exclude: ['tutor'] },
  ];

  it('counts passes and failures', () => {
    const report = evaluateGoldenSet(cases, realCard);
    expect(report.total).toBe(3);
    expect(report.passed).toBe(3);
    expect(report.failed).toBe(0);
    expect(report.failures).toEqual([]);
  });

  it('computes per-role precision and recall from labels only', () => {
    const report = evaluateGoldenSet(cases, realCard);
    const ramp = report.perRole.ramp;
    expect(ramp.expected).toBe(2);
    expect(ramp.excluded).toBe(1);
    expect(ramp.truePositives).toBe(2);
    expect(ramp.falseNegatives).toBe(0);
    expect(ramp.falsePositives).toBe(0);
    expect(ramp.precision).toBe(1);
    expect(ramp.recall).toBe(1);
  });

  it('reports null precision/recall for unlabeled roles rather than a fake 1.0', () => {
    const report = evaluateGoldenSet(cases, realCard);
    expect(report.perRole.board_wipe.precision).toBeNull();
    expect(report.perRole.board_wipe.recall).toBeNull();
  });

  it('records a false negative as a recall miss', () => {
    const report = evaluateGoldenSet(
      [{ name: 'Sol Ring', expect: ['tutor'], exclude: [] }],
      realCard,
    );
    expect(report.perRole.tutor.falseNegatives).toBe(1);
    expect(report.perRole.tutor.recall).toBe(0);
    expect(report.perRole.tutor.precision).toBeNull();
  });

  it('records an excluded-but-present role as a precision miss', () => {
    const report = evaluateGoldenSet(
      [{ name: 'Sol Ring', expect: [], exclude: ['ramp'] }],
      realCard,
    );
    expect(report.perRole.ramp.falsePositives).toBe(1);
    expect(report.perRole.ramp.precision).toBe(0);
  });

  it('tallies rule IDs across the set', () => {
    const report = evaluateGoldenSet(cases, realCard);
    expect(report.perRuleId['mana-ability']).toBe(1);
    expect(report.perRuleId['land-search']).toBe(1);
    expect(report.perRuleId['library-search']).toBe(1);
  });
});

describe('the committed golden set', () => {
  it('is non-trivial and every card resolves to a fixture', () => {
    expect(GOLDEN_SET.length).toBeGreaterThan(150);
    for (const c of GOLDEN_SET) expect(() => realCard(c.name)).not.toThrow();
  });

  it('has no duplicate case names', () => {
    const names = GOLDEN_SET.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('never both expects and excludes the same role', () => {
    for (const c of GOLDEN_SET) {
      const overlap = c.expect.filter((r) => c.exclude.includes(r));
      expect(overlap, `${c.name} contradicts itself`).toEqual([]);
    }
  });

  it('covers every role with at least one expectation', () => {
    const covered = new Set(GOLDEN_SET.flatMap((c) => c.expect));
    for (const role of [
      'ramp', 'card_advantage', 'card_selection', 'tutor', 'interaction',
      'board_wipe', 'protection', 'recursion', 'graveyard_hate',
    ] as const) {
      expect(covered, `no expectation labeled for ${role}`).toContain(role);
    }
  });

  it('produces no unexpected failures beyond documented known gaps', () => {
    const report = evaluateGoldenSet(GOLDEN_SET, realCard);
    const undocumented = report.failures.filter(
      (f) => !GOLDEN_SET.find((c) => c.name === f.name)?.note?.startsWith('KNOWN GAP'),
    );
    expect(
      undocumented.map((f) => `${f.name}: missing=${f.missing} unexpected=${f.unexpected}`),
    ).toEqual([]);
  });
});

describe('suspicious-case diagnostics', () => {
  it('flags a land classified as ramp without calling it an error', () => {
    // Treasure-producing lands are genuinely ramp; this is a review signal.
    const land = makeCard({
      name: 'Treasure Land',
      typeLine: 'Land',
      oracleText: '{T}: Add {C}.\n{X}{X}, {T}, Sacrifice this land: Create X Treasure tokens.',
    });
    const signals = findSuspiciousCases(land);
    expect(signals.map((s) => s.signal)).toContain('land-as-ramp');
  });

  it('does not flag ordinary unconditional wipes', () => {
    const wipe = makeCard({ typeLine: 'Sorcery', oracleText: 'Destroy all creatures.' });
    expect(findSuspiciousCases(wipe).map((s) => s.signal)).not.toContain(
      'overload-without-base-mode',
    );
  });

  it('returns nothing for a card with no roles', () => {
    expect(findSuspiciousCases(basicLand('Forest', 'G'))).toEqual([]);
  });

  it('includes the roles and rule IDs behind a signal', () => {
    const land = makeCard({
      typeLine: 'Land',
      oracleText: '{2}, {T}: Create a Treasure token.',
    });
    const [signal] = findSuspiciousCases(land);
    expect(signal?.roles).toContain('ramp');
    expect(signal?.ruleIds).toContain('treasure-generation');
    expect(signal?.reason).toBeTruthy();
  });
});
