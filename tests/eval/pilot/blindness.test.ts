import { describe, expect, it } from 'vitest';
import {
  assertBundleIsBlind,
  findBlindnessViolations,
  verifyLabelPriority,
} from '@/eval/pilot/blindness';

describe('bundle blindness', () => {
  it('accepts a bundle containing only decklists and rubric prompts', () => {
    const clean = [
      '# Deck rating worksheet',
      '## Deck deck-a1b2',
      '1 Sol Ring',
      '1 Arcane Signet',
      '36 Forest',
      '| 1 | Earliest realistic turn this deck could win | turn number | |',
    ].join('\n');
    expect(findBlindnessViolations(clean)).toEqual([]);
    expect(() => assertBundleIsBlind(clean)).not.toThrow();
  });

  it.each([
    ['Speed: 53.61'],
    ['Consistency 68.9'],
    ['Interaction score'],
    ['Resilience 40.33'],
    ['Composite Power Index 55.2'],
    ['win speed 37.5'],
    ['targeted access 30'],
    ['card flow 13.5'],
    ['weakest-link redundancy'],
    ['commander backup unavailable'],
    ['board reset 4.9'],
  ])('rejects a bundle leaking %s', (leak) => {
    const text = `## Deck deck-a1b2\n1 Sol Ring\n${leak}\n`;
    expect(findBlindnessViolations(text).length).toBeGreaterThan(0);
    expect(() => assertBundleIsBlind(text)).toThrow(/leaks model information/);
  });

  it.each([['cEDH staple list'], ['precon upgrade'], ['anchor deck'], ['believed tier: casual']])(
    'rejects curator-only tier language: %s',
    (leak) => {
      expect(() => assertBundleIsBlind(`## Deck deck-a1b2\n${leak}\n`)).toThrow();
    },
  );

  it('reports every leak at once rather than one per run', () => {
    const text = 'Speed 50\nConsistency 60\nInteraction 70\n';
    expect(findBlindnessViolations(text).length).toBe(3);
  });

  it('names the offending term and its context in the failure', () => {
    expect(() => assertBundleIsBlind('1 Sol Ring\nResilience 40.33\n1 Forest'))
      .toThrow(/Resilience/);
  });
});

describe('legitimate card names are not leaks', () => {
  /*
   * A sweep of all 31,830 Commander-legal cards found 23 names colliding with
   * forbidden terms. Scanning decklist lines for those words would reject
   * valid decks, so detection is line-role aware.
   */
  it.each([
    ['1 Boots of Speed'],
    ['1 Uncanny Speed'],
    ['4 Need for Speed'],
    ['1 Talisman of Resilience'],
    ['1 Divine Resilience'],
    ['1 Composite Golem'],
    ['1 Reality Anchor'],
    ['1 The Temporal Anchor'],
    ['1 Forging the Anchor'],
    ['1 Arm-Mounted Anchor'],
    ['36 Forest'],
    ['1x Sol Ring'],
  ])('allows the decklist line %s', (line) => {
    expect(findBlindnessViolations(line)).toEqual([]);
  });

  it('allows a split card whose second face contains a forbidden word', () => {
    const line = '1 Slicer, Hired Muscle // Slicer, High-Speed Antagonist';
    expect(findBlindnessViolations(line)).toEqual([]);
  });

  it('allows a Commander: header naming such a card', () => {
    expect(findBlindnessViolations('Commander: Composite Golem')).toEqual([]);
  });

  it('still rejects an annotation appended after a card name', () => {
    // The case that must not be weakened.
    const v = findBlindnessViolations('1 Sol Ring // Composite Power Index 55');
    expect(v.length).toBeGreaterThan(0);
  });

  it('still rejects a key: value annotation on a card line', () => {
    expect(findBlindnessViolations('1 Sol Ring // tier: cedh').length).toBeGreaterThan(0);
  });

  it('rejects leakage in every structural line role', () => {
    const roles: [string, string][] = [
      ['heading', '## Deck deck-a1b2 (cEDH)'],
      ['comment', '// Composite Power Index 55'],
      ['hash comment', '# believed tier: precon'],
      ['score field', 'Speed: 53.61'],
      ['table row', '| deck-a1b2 | Resilience 40.33 |'],
      ['quote', '> this is an anchor deck'],
      ['prose', 'This deck has excellent card flow.'],
    ];
    for (const [role, text] of roles) {
      expect(findBlindnessViolations(text).length, role).toBeGreaterThan(0);
    }
  });

  it('reports the line number so a leak is findable', () => {
    const text = '1 Sol Ring\n1 Forest\n// Speed: 50\n';
    const v = findBlindnessViolations(text);
    expect(v[0]!.line).toBe(3);
  });
});

describe('label priority', () => {
  const at = (path: string, committedAt: number) => ({ path, committedAt });

  it('passes when every label precedes the first model score', () => {
    const r = verifyLabelPriority(
      [at('labels/r1/deck-a1b2.json', 1000), at('labels/r2/deck-a1b2.json', 1100)],
      [at('model/deck-a1b2.json', 2000)],
    );
    expect(r.ok).toBe(true);
  });

  it('fails when any label was committed after a model score', () => {
    const r = verifyLabelPriority(
      [at('labels/r1/deck-a1b2.json', 1000), at('labels/r2/deck-a1b2.json', 2500)],
      [at('model/deck-a1b2.json', 2000)],
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/labels\/r2/);
  });

  it('fails on an equal timestamp: one commit proves no ordering', () => {
    /*
     * A single commit containing both labels and scores cannot establish which
     * existed first, so it must not pass.
     */
    const r = verifyLabelPriority([at('labels/r1/x.json', 2000)], [at('model/x.json', 2000)]);
    expect(r.ok).toBe(false);
  });

  it('passes before any model score is committed', () => {
    const r = verifyLabelPriority([at('labels/r1/x.json', 1000)], []);
    expect(r.ok).toBe(true);
    expect(r.reason).toMatch(/safely first/);
  });

  it('fails when there are no committed labels to verify', () => {
    // An uncommitted label has no verifiable timestamp and proves nothing.
    const r = verifyLabelPriority([], [at('model/x.json', 2000)]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no committed labels/);
  });
});
