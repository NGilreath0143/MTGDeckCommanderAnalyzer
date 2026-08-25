import { createReadStream, existsSync, mkdirSync, renameSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { mapCardRow } from '@/infra/db/mapCardRow';
import { mapScryfallCard } from '@/infra/scryfall/mapScryfallCard';
import type { ScryfallCard } from '@/infra/scryfall/types';
import { isLegalInCommander } from '@/domain/cardFacts';
import type { ResolvedCard } from '@/domain/types';

/**
 * DEVELOPER TOOLING ONLY. Nothing under src/eval/ may be imported by
 * src/app/, src/pipeline/, or src/infra/ — it exists to evaluate the
 * classifier offline, never to serve a request.
 *
 * Reads Scryfall's `oracle_cards` bulk export (one entry per unique card) and
 * normalizes each entry into the domain's ResolvedCard.
 *
 * The normalization seam is preserved exactly: raw Scryfall JSON goes through
 * mapScryfallCard -> mapCardRow, so mapCardRow remains the ONLY producer of
 * ResolvedCard and the domain classifier never sees a raw Scryfall object.
 */

const BULK_INDEX_URL = 'https://api.scryfall.com/bulk-data';
const DEFAULT_CACHE = '.cache/oracle-cards.jsonl.gz';
const USER_AGENT = process.env.SCRYFALL_USER_AGENT ?? 'MTGCommanderAnalyzer/0.1';

/** The bulk-data index entry we care about. */
interface BulkEntry {
  type: string;
  updated_at: string;
  /** Current field name; the older `download_uri` is accepted as a fallback. */
  jsonl_download_uri?: string;
  download_uri?: string;
  compressed_size?: number;
}

/**
 * Resolve the download URL for the oracle_cards dataset.
 *
 * Verified live: the index exposes `jsonl_download_uri` (not `download_uri`),
 * so both are handled rather than assuming either.
 */
export async function findOracleCardsUrl(
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<{ url: string; updatedAt: string }> {
  const response = await fetchImpl(BULK_INDEX_URL, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
  });
  if (!response.ok) {
    throw new Error(`Scryfall bulk-data index failed: HTTP ${response.status}`);
  }
  const payload = (await response.json()) as { data?: BulkEntry[] };
  const entry = (payload.data ?? []).find((e) => e.type === 'oracle_cards');
  const url = entry?.jsonl_download_uri ?? entry?.download_uri;
  if (!entry || !url) throw new Error('oracle_cards bulk entry not found');
  return { url, updatedAt: entry.updated_at };
}

/**
 * Ensure the bulk file is on disk, downloading it once. The cache path is
 * gitignored: the blob is ~25MB and must never enter version control.
 */
export async function ensureBulkFile(
  cachePath = DEFAULT_CACHE,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<string> {
  if (existsSync(cachePath)) return cachePath;

  const { url, updatedAt } = await findOracleCardsUrl(fetchImpl);
  process.stderr.write(`downloading oracle_cards (updated ${updatedAt})\n`);

  const response = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok || !response.body) {
    throw new Error(`bulk download failed: HTTP ${response.status}`);
  }

  mkdirSync(dirname(cachePath), { recursive: true });
  // Write to a temp path first so an interrupted download cannot leave a
  // truncated file that later runs would treat as complete.
  const temp = `${cachePath}.partial`;
  await pipeline(response.body as unknown as NodeJS.ReadableStream, createWriteStream(temp));
  renameSync(temp, cachePath);
  return cachePath;
}

/**
 * Stream the bulk file as ResolvedCards.
 *
 * Streaming rather than JSON.parse of the whole file: the export is ~25MB
 * gzipped and ~38k cards, so holding it in memory is unnecessary.
 */
export async function* streamBulkCards(
  path: string,
): AsyncGenerator<ResolvedCard, void, undefined> {
  const lines = createInterface({
    input: createReadStream(path).pipe(createGunzip()),
    crlfDelay: Infinity,
  });

  for await (const line of lines) {
    if (!line.trim()) continue;
    let raw: ScryfallCard;
    try {
      raw = JSON.parse(line) as ScryfallCard;
    } catch {
      continue; // A malformed line should not abort a 38k-card sweep.
    }
    yield mapCardRow(mapScryfallCard(raw));
  }
}

/** Stream only Commander-legal cards (excludes banned and not_legal). */
export async function* streamCommanderLegalCards(
  path: string,
): AsyncGenerator<ResolvedCard, void, undefined> {
  for await (const card of streamBulkCards(path)) {
    if (isLegalInCommander(card)) yield card;
  }
}
