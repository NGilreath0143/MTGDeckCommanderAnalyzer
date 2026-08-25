import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DeckId } from './types';

/**
 * Frozen-corpus integrity verification. Dev-only.
 *
 * The calibration pilot is only meaningful if the decks raters judged are
 * provably the decks that were frozen. `corpus/FREEZE.json` records a
 * SHA-256 for every decklist and metadata record plus a rollup digest over
 * all of them; this module recomputes those and refuses to proceed on any
 * mismatch.
 *
 * Deliberately fails CLOSED and offers no bypass. A manifest that can be
 * skipped with a flag provides no guarantee at all, and the temptation to
 * skip it is highest exactly when something has drifted. If the corpus is
 * meant to change, the correct process is an explicit new freeze and review,
 * not a `--force`.
 *
 * It also never regenerates the manifest. Silently rewriting the digest on
 * mismatch would convert a detected corruption into an accepted one.
 */

/** One frozen deck's expected digests. */
export interface FreezeEntry {
  id: DeckId;
  decklistSha256: string;
  metaSha256: string;
}

export interface FreezeManifest {
  phase: string;
  artifact: string;
  frozenAt: string;
  deckCount: number;
  note?: string;
  corpusDigest: string;
  decks: FreezeEntry[];
}

export type FreezeProblemKind =
  | 'manifest_missing'
  | 'manifest_unreadable'
  | 'deck_count_mismatch'
  | 'decklist_missing'
  | 'meta_missing'
  | 'decklist_digest_mismatch'
  | 'meta_digest_mismatch'
  | 'unexpected_decklist'
  | 'unexpected_meta'
  | 'corpus_digest_mismatch';

export interface FreezeProblem {
  kind: FreezeProblemKind;
  detail: string;
}

export interface FreezeResult {
  ok: boolean;
  /** Recomputed rollup, absent when the manifest could not be read. */
  corpusDigest?: string;
  problems: FreezeProblem[];
}

export interface FreezePaths {
  manifest: string;
  decks: string;
  meta: string;
}

export const DEFAULT_FREEZE_PATHS: FreezePaths = {
  manifest: 'corpus/FREEZE.json',
  decks: 'corpus/decks',
  meta: 'corpus/meta',
};

const sha256 = (path: string): string =>
  createHash('sha256').update(readFileSync(path)).digest('hex');

/**
 * The rollup digest: per-deck id + decklist digest + metadata digest, folded
 * in sorted id order.
 *
 * Order is fixed by sorting so the digest depends on content alone, not on
 * directory listing order, which varies by filesystem.
 */
export function computeCorpusDigest(entries: readonly FreezeEntry[]): string {
  const roll = createHash('sha256');
  for (const e of [...entries].sort((a, b) => a.id.localeCompare(b.id))) {
    roll.update(e.id);
    roll.update(e.decklistSha256);
    roll.update(e.metaSha256);
  }
  return roll.digest('hex');
}

/**
 * Verify the frozen corpus on disk against its manifest.
 *
 * Reports every problem rather than the first, so a drifted corpus can be
 * diagnosed in one run instead of one file per attempt.
 */
export function verifyFrozenCorpus(paths: FreezePaths = DEFAULT_FREEZE_PATHS): FreezeResult {
  const problems: FreezeProblem[] = [];

  if (!existsSync(paths.manifest)) {
    return {
      ok: false,
      problems: [{ kind: 'manifest_missing', detail: `no freeze manifest at ${paths.manifest}` }],
    };
  }

  let manifest: FreezeManifest;
  try {
    manifest = JSON.parse(readFileSync(paths.manifest, 'utf8')) as FreezeManifest;
    if (!Array.isArray(manifest.decks)) throw new Error('decks is not an array');
  } catch (error) {
    return {
      ok: false,
      problems: [
        {
          kind: 'manifest_unreadable',
          detail: `${paths.manifest}: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }

  if (manifest.decks.length !== manifest.deckCount) {
    problems.push({
      kind: 'deck_count_mismatch',
      detail: `manifest lists ${manifest.decks.length} decks but declares deckCount ${manifest.deckCount}`,
    });
  }

  const recomputed: FreezeEntry[] = [];
  for (const entry of manifest.decks) {
    const deckPath = join(paths.decks, `${entry.id}.txt`);
    const metaPath = join(paths.meta, `${entry.id}.json`);

    const deckExists = existsSync(deckPath);
    const metaExists = existsSync(metaPath);
    if (!deckExists) {
      problems.push({ kind: 'decklist_missing', detail: `missing frozen decklist: ${deckPath}` });
    }
    if (!metaExists) {
      problems.push({ kind: 'meta_missing', detail: `missing frozen metadata: ${metaPath}` });
    }
    if (!deckExists || !metaExists) continue;

    const deckDigest = sha256(deckPath);
    const metaDigest = sha256(metaPath);
    if (deckDigest !== entry.decklistSha256) {
      problems.push({
        kind: 'decklist_digest_mismatch',
        detail: `${deckPath}: expected ${entry.decklistSha256.slice(0, 16)}… got ${deckDigest.slice(0, 16)}…`,
      });
    }
    if (metaDigest !== entry.metaSha256) {
      problems.push({
        kind: 'meta_digest_mismatch',
        detail: `${metaPath}: expected ${entry.metaSha256.slice(0, 16)}… got ${metaDigest.slice(0, 16)}…`,
      });
    }
    recomputed.push({ id: entry.id, decklistSha256: deckDigest, metaSha256: metaDigest });
  }

  /*
   * A file present on disk but absent from the manifest is as much a drift as
   * a modified one: a 13th deck would silently enter the rater set.
   */
  const frozenIds = new Set(manifest.decks.map((d) => d.id));
  if (existsSync(paths.decks)) {
    for (const f of readdirSync(paths.decks).filter((x) => x.endsWith('.txt'))) {
      const id = f.slice(0, -4);
      if (!frozenIds.has(id)) {
        problems.push({ kind: 'unexpected_decklist', detail: `${join(paths.decks, f)} is not in the manifest` });
      }
    }
  }
  if (existsSync(paths.meta)) {
    for (const f of readdirSync(paths.meta).filter((x) => x.endsWith('.json'))) {
      const id = f.slice(0, -5);
      if (!frozenIds.has(id)) {
        problems.push({ kind: 'unexpected_meta', detail: `${join(paths.meta, f)} is not in the manifest` });
      }
    }
  }

  const corpusDigest = computeCorpusDigest(recomputed);
  if (recomputed.length === manifest.decks.length && corpusDigest !== manifest.corpusDigest) {
    problems.push({
      kind: 'corpus_digest_mismatch',
      detail: `corpus rollup expected ${manifest.corpusDigest.slice(0, 16)}… got ${corpusDigest.slice(0, 16)}…`,
    });
  }

  return { ok: problems.length === 0, corpusDigest, problems };
}

/** Format a failure for an operator, naming every drifted file. */
export function describeFreezeFailure(result: FreezeResult): string {
  const lines = ['STOP — CORPUS NO LONGER MATCHES FREEZE', ''];
  for (const p of result.problems) lines.push(`  [${p.kind}] ${p.detail}`);
  lines.push(
    '',
    'The manifest is not regenerated automatically. If the corpus is meant to',
    'have changed, run an explicit new freeze and review; do not bypass this.',
  );
  return lines.join('\n');
}
