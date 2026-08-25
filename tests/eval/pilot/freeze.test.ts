import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  computeCorpusDigest,
  describeFreezeFailure,
  verifyFrozenCorpus,
  type FreezeManifest,
  type FreezePaths,
} from '@/eval/pilot/freeze';

/**
 * Freeze-integrity contract.
 *
 * Every case builds a throwaway corpus in a temp directory: the real frozen
 * corpus is never mutated, since a test that tampers with it would defeat the
 * thing being tested.
 */

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

let root: string;
let paths: FreezePaths;

/** Build a valid frozen corpus of `n` decks and return its manifest. */
function makeCorpus(n = 3): FreezeManifest {
  const entries = Array.from({ length: n }, (_, i) => {
    const id = `deck-${(0xa000 + i).toString(16)}`;
    const decklist = `Commander\n1 Commander ${i}\n\n1 Sol Ring\n36 Forest\n`;
    const meta = JSON.stringify({ id, commander: `Commander ${i}` });
    writeFileSync(join(paths.decks, `${id}.txt`), decklist);
    writeFileSync(join(paths.meta, `${id}.json`), meta);
    return { id, decklistSha256: sha(decklist), metaSha256: sha(meta) };
  });

  const manifest: FreezeManifest = {
    phase: 'test',
    artifact: 'test corpus',
    frozenAt: '2026-08-25',
    deckCount: entries.length,
    corpusDigest: computeCorpusDigest(entries),
    decks: entries,
  };
  writeFileSync(paths.manifest, JSON.stringify(manifest, null, 1));
  return manifest;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'freeze-test-'));
  paths = {
    manifest: join(root, 'FREEZE.json'),
    decks: join(root, 'decks'),
    meta: join(root, 'meta'),
  };
  mkdirSync(paths.decks, { recursive: true });
  mkdirSync(paths.meta, { recursive: true });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('a valid frozen corpus', () => {
  it('passes and reports the recomputed digest', () => {
    const manifest = makeCorpus();
    const r = verifyFrozenCorpus(paths);
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.corpusDigest).toBe(manifest.corpusDigest);
  });

  it('is order-independent: the digest depends on content, not listing order', () => {
    const a = [
      { id: 'deck-a001', decklistSha256: 'aa', metaSha256: 'bb' },
      { id: 'deck-a002', decklistSha256: 'cc', metaSha256: 'dd' },
    ];
    expect(computeCorpusDigest(a)).toBe(computeCorpusDigest([...a].reverse()));
  });
});

describe('drift is detected', () => {
  it('fails when a decklist changed', () => {
    const m = makeCorpus();
    const id = m.decks[0]!.id;
    writeFileSync(join(paths.decks, `${id}.txt`), 'Commander\n1 Something Else\n');
    const r = verifyFrozenCorpus(paths);
    expect(r.ok).toBe(false);
    expect(r.problems.some((p) => p.kind === 'decklist_digest_mismatch')).toBe(true);
    // The failure must name the offending file.
    expect(r.problems.find((p) => p.kind === 'decklist_digest_mismatch')!.detail).toContain(id);
  });

  it('fails when metadata changed', () => {
    const m = makeCorpus();
    const id = m.decks[1]!.id;
    writeFileSync(join(paths.meta, `${id}.json`), JSON.stringify({ id, commander: 'Tampered' }));
    const r = verifyFrozenCorpus(paths);
    expect(r.ok).toBe(false);
    expect(r.problems.some((p) => p.kind === 'meta_digest_mismatch')).toBe(true);
  });

  it('fails when a decklist is missing', () => {
    const m = makeCorpus();
    unlinkSync(join(paths.decks, `${m.decks[0]!.id}.txt`));
    const r = verifyFrozenCorpus(paths);
    expect(r.ok).toBe(false);
    expect(r.problems.some((p) => p.kind === 'decklist_missing')).toBe(true);
  });

  it('fails when metadata is missing', () => {
    const m = makeCorpus();
    unlinkSync(join(paths.meta, `${m.decks[0]!.id}.json`));
    const r = verifyFrozenCorpus(paths);
    expect(r.ok).toBe(false);
    expect(r.problems.some((p) => p.kind === 'meta_missing')).toBe(true);
  });

  it('fails when the recorded corpus digest was altered', () => {
    const m = makeCorpus();
    writeFileSync(paths.manifest, JSON.stringify({ ...m, corpusDigest: 'f'.repeat(64) }));
    const r = verifyFrozenCorpus(paths);
    expect(r.ok).toBe(false);
    expect(r.problems.some((p) => p.kind === 'corpus_digest_mismatch')).toBe(true);
  });

  it('fails on an extra decklist not in the manifest', () => {
    // A 13th deck would silently enter the rater set.
    makeCorpus();
    writeFileSync(join(paths.decks, 'deck-ffff.txt'), '1 Sol Ring\n');
    const r = verifyFrozenCorpus(paths);
    expect(r.ok).toBe(false);
    expect(r.problems.some((p) => p.kind === 'unexpected_decklist')).toBe(true);
  });

  it('fails on an extra metadata record not in the manifest', () => {
    makeCorpus();
    writeFileSync(join(paths.meta, 'deck-ffff.json'), '{}');
    const r = verifyFrozenCorpus(paths);
    expect(r.ok).toBe(false);
    expect(r.problems.some((p) => p.kind === 'unexpected_meta')).toBe(true);
  });

  it('fails when deckCount disagrees with the deck list', () => {
    const m = makeCorpus();
    writeFileSync(paths.manifest, JSON.stringify({ ...m, deckCount: 99 }));
    expect(verifyFrozenCorpus(paths).problems.some((p) => p.kind === 'deck_count_mismatch')).toBe(true);
  });

  it('fails when the manifest is absent or unreadable', () => {
    expect(verifyFrozenCorpus(paths).problems[0]!.kind).toBe('manifest_missing');
    writeFileSync(paths.manifest, 'not json at all');
    expect(verifyFrozenCorpus(paths).problems[0]!.kind).toBe('manifest_unreadable');
  });

  it('reports every problem at once rather than the first', () => {
    const m = makeCorpus();
    writeFileSync(join(paths.decks, `${m.decks[0]!.id}.txt`), 'changed');
    writeFileSync(join(paths.meta, `${m.decks[1]!.id}.json`), '{"changed":true}');
    expect(verifyFrozenCorpus(paths).problems.length).toBeGreaterThanOrEqual(2);
  });
});

describe('recovery', () => {
  it('passes again once the corpus is restored', () => {
    const m = makeCorpus();
    const id = m.decks[0]!.id;
    const path = join(paths.decks, `${id}.txt`);
    const original = readFileSync(path, 'utf8');

    writeFileSync(path, 'tampered');
    expect(verifyFrozenCorpus(paths).ok).toBe(false);

    writeFileSync(path, original);
    expect(verifyFrozenCorpus(paths).ok).toBe(true);
  });
});

describe('failure reporting', () => {
  it('leads with the stop message and never suggests regenerating', () => {
    const m = makeCorpus();
    writeFileSync(join(paths.decks, `${m.decks[0]!.id}.txt`), 'tampered');
    const text = describeFreezeFailure(verifyFrozenCorpus(paths));
    expect(text).toMatch(/^STOP — CORPUS NO LONGER MATCHES FREEZE/);
    expect(text).toMatch(/not regenerated automatically/);
    expect(text).toMatch(/do not bypass/i);
  });
});
