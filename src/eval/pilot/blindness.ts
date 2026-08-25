/**
 * Blindness enforcement for the calibration pilot. Pure.
 *
 * The calibration is circular if raters can see model output before their
 * judgments are final: the model would become part of generating its own
 * labels. Asking raters to ignore scores they can see does not work, so
 * blindness is protected structurally instead.
 *
 * Two mechanisms, with deliberately different strengths:
 *
 *  1. `assertBundleIsBlind` is the ACTUAL mechanical protection. It inspects
 *     the exact text a rater will receive and refuses to hand it over if any
 *     structural line — a heading, comment, annotation, score field, table
 *     row, or tier label — mentions model or curator information.
 *
 *     Detection is LINE-ROLE AWARE rather than whole-document. A sweep of all
 *     31,830 Commander-legal cards found 23 legitimate card names that collide
 *     with forbidden terms: Boots of Speed, Talisman of Resilience, Composite
 *     Golem and Reality Anchor among them. Scanning decklist lines for those
 *     words would reject valid decks, so `1 Boots of Speed` is exempt while
 *     `// Composite Power Index 55` on the same list is still caught.
 *
 *  2. `verifyLabelPriority` is an AUDITABLE REPOSITORY-ORDER GUARD, and no
 *     more than that. It shows that label files were committed before model
 *     scores were. It is NOT proof that a rater never saw model output — a
 *     score could have been shown out of band, and git cannot know. Treat it
 *     as a tamper-evident record that the intended workflow was followed.
 */

/**
 * Terms that must never appear in a rater bundle's structural text.
 *
 * Covers the five emitted scores, the component vocabulary that would let a
 * rater reverse-engineer them, and the tier language that would prime a
 * judgment before the decklist is read.
 */
const FORBIDDEN_TERMS: readonly RegExp[] = [
  // the five frozen outputs
  /\bspeed\b/i,
  /\bconsistency\b/i,
  /\binteraction\b/i,
  /\bresilience\b/i,
  /\bcomposite\b/i,
  /\bpower index\b/i,
  // component vocabulary that leaks the model's structure
  /\bwin speed\b/i,
  /\bdevelopment score\b/i,
  /\btargeted access\b/i,
  /\bcard flow\b/i,
  /\bweakest.link\b/i,
  /\bcommander backup\b/i,
  /\bboard reset\b/i,
  // dimension band labels
  /\b(?:low|moderate|good|high|elite)\s*\/\s*(?:low|moderate|good|high|elite)\b/i,
  // curator-only tier language
  /\bbelieved\s*tier\b/i,
  /\bcedh\b/i,
  /\bprecon\b/i,
  /\banchor\b/i,
];

/**
 * A decklist quantity line: `1 Sol Ring`, `4x Lightning Bolt`, `36 Forest`.
 *
 * Everything after the quantity is a card name, which is exactly what the
 * rater is meant to read. Card names legitimately contain forbidden words, so
 * these lines carry no structural information and are exempt.
 *
 * Split and modal cards legitimately contain ` // ` in their printed name
 * (`Slicer, Hired Muscle // Slicer, High-Speed Antagonist`), so a bare `//`
 * cannot mean "comment" inside a card line. An ANNOTATION is distinguished by
 * a `//` that is not part of a card name: `1 Sol Ring // tier: cedh` has no
 * second card face, so the trailing text is scanned. This is resolved by
 * splitting on ` // ` and requiring every part to look like a card name.
 */
const DECKLIST_QUANTITY_LINE = /^\d+\s*x?\s+[^#(|]+$/i;

/** A printed card name: letters, digits, and ordinary punctuation only. */
const CARD_NAME_PART = /^[\p{L}\p{N}][\p{L}\p{N} ,.'’:!?&+/-]*$/u;

/** A `Commander:` style section header naming a card. */
const DECKLIST_SECTION_LINE = /^(?:commander|deck|sideboard|maybeboard)\s*:\s*[^/#|]*$/i;

/**
 * Is this line pure decklist data, where a card name may contain any word?
 *
 * Structural lines — headings, comments, table rows, prose — are always
 * scanned. Only bare card lines and blanks are exempt.
 */
export function isDecklistDataLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === '') return true;
  // Comments, headings and table rows are structural regardless of content.
  if (/^(?:\/\/|#|\||>)/.test(trimmed)) return false;
  if (!DECKLIST_QUANTITY_LINE.test(trimmed) && !DECKLIST_SECTION_LINE.test(trimmed)) {
    return false;
  }
  /*
   * Every ` // `-separated part must read like a card name, AND no part may
   * itself contain a forbidden term. A split card passes on both counts
   * (`Slicer, Hired Muscle // Slicer, High-Speed Antagonist` — "High-Speed"
   * is not a standalone `speed` word... but "Boots of Speed" is, which is
   * precisely why the exemption is needed).
   *
   * The second condition is what keeps an appended annotation in scope:
   * `1 Sol Ring // Composite Power Index 55` looks name-shaped, so shape
   * alone would let it through. A real card name that trips a forbidden term
   * is exempted only when the WHOLE part is a plausible name and the term is
   * embedded in it — never when the part reads as metadata (`key: value`,
   * or a trailing bare number).
   */
  const body = trimmed.replace(/^\d+\s*x?\s+/i, '').replace(/^\w+\s*:\s*/i, '');
  const parts = body.split(/\s*\/\/\s*/).map((x) => x.trim());
  if (!parts.every((part) => CARD_NAME_PART.test(part))) return false;
  // Metadata shapes never appear in a printed card name.
  return !parts.some((part) => /:\s*\S/.test(part) || /\s\d+(?:\.\d+)?$/.test(part));
}

export interface BlindnessViolation {
  term: string;
  /** 1-based line number, so a leak is findable in the generated file. */
  line: number;
  /** The offending line, for a readable failure message. */
  context: string;
}

/**
 * Find every forbidden term in the structural text destined for a rater.
 *
 * Returns violations rather than throwing so a caller can report all leaks at
 * once instead of one per run. Decklist card lines are skipped — see
 * `isDecklistDataLine`.
 */
export function findBlindnessViolations(bundleText: string): BlindnessViolation[] {
  const violations: BlindnessViolation[] = [];

  for (const [index, line] of bundleText.split('\n').entries()) {
    if (isDecklistDataLine(line)) continue;
    for (const pattern of FORBIDDEN_TERMS) {
      const match = pattern.exec(line);
      if (!match) continue;
      violations.push({
        term: match[0],
        line: index + 1,
        context: line.trim().replace(/\s+/g, ' ').slice(0, 90),
      });
    }
  }
  return violations;
}

/** Throw unless the bundle text is free of model-derived information. */
export function assertBundleIsBlind(bundleText: string): void {
  const violations = findBlindnessViolations(bundleText);
  if (violations.length === 0) return;
  const detail = violations
    .map((v) => `  line ${v.line}: "${v.term}" in: ${v.context}`)
    .join('\n');
  throw new Error(
    `Rater bundle leaks model information and was not written.\n${detail}\n` +
      'A bundle must contain decklists and the rubric only.',
  );
}

export interface CommitTime {
  path: string;
  /** Unix seconds of the commit that added or last changed this path. */
  committedAt: number;
}

export interface PriorityResult {
  ok: boolean;
  /** Human-readable explanation, populated whether or not the check passed. */
  reason: string;
}

/**
 * Auditable repository-order guard: were label files committed before model
 * scores?
 *
 * This is evidence about the REPOSITORY, not about what a rater saw. It cannot
 * detect a score shown out of band, so it must never be described as proof of
 * blindness. Bundle leak detection is the mechanical protection; this is the
 * tamper-evident record that the intended workflow was followed.
 *
 * Deliberately strict: an uncommitted label file has no verifiable timestamp,
 * so it cannot establish priority and the check fails. Equal timestamps also
 * fail — a single commit containing both proves nothing about ordering.
 */
export function verifyLabelPriority(
  labels: readonly CommitTime[],
  modelScores: readonly CommitTime[],
): PriorityResult {
  if (labels.length === 0) {
    return { ok: false, reason: 'no committed labels found: nothing to verify' };
  }
  if (modelScores.length === 0) {
    return { ok: true, reason: 'no model scores committed yet; labels are safely first' };
  }

  const earliestScore = Math.min(...modelScores.map((m) => m.committedAt));
  const lateLabels = labels.filter((l) => l.committedAt >= earliestScore);

  if (lateLabels.length > 0) {
    const names = lateLabels.map((l) => l.path).join(', ');
    return {
      ok: false,
      reason:
        `${lateLabels.length} label file(s) were committed at or after the first ` +
        `model score, so repository order cannot establish priority: ${names}`,
    };
  }
  return {
    ok: true,
    reason: `all ${labels.length} label file(s) precede the first model score`,
  };
}
