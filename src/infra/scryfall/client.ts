import type {
  ScryfallCard,
  ScryfallCollectionResponse,
  ScryfallIdentifier,
} from './types';

/**
 * Scryfall HTTP client. The only outbound network access in the app.
 *
 * Honours Scryfall's documented limits: at most 75 identifiers per
 * /cards/collection request, and a delay between requests. `fetchImpl` and
 * `sleep` are injectable so tests never touch the network or actually wait.
 */

export const MAX_IDENTIFIERS_PER_REQUEST = 75;
const DEFAULT_DELAY_MS = 100;
const DEFAULT_BASE_URL = 'https://api.scryfall.com';

export interface CollectionResult {
  found: ScryfallCard[];
  /** The identifier objects Scryfall echoed back as unmatched. */
  notFound: ScryfallIdentifier[];
  /** How many HTTP requests were issued (asserted in tests, logged in dev). */
  requests: number;
}

export interface ScryfallClientOptions {
  fetchImpl?: typeof fetch;
  userAgent?: string;
  delayMs?: number;
  baseUrl?: string;
  sleep?: (ms: number) => Promise<void>;
}

export interface ScryfallClient {
  fetchCollection(identifiers: ScryfallIdentifier[]): Promise<CollectionResult>;
}

/** Split a list into fixed-size chunks. Pure; exported for testing. */
export function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) throw new Error('chunk size must be positive');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export class ScryfallError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ScryfallError';
  }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createScryfallClient(options: ScryfallClientOptions = {}): ScryfallClient {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const userAgent =
    options.userAgent ?? process.env.SCRYFALL_USER_AGENT ?? 'MTGCommanderAnalyzer/0.1';
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const sleep = options.sleep ?? defaultSleep;

  async function fetchCollection(
    identifiers: ScryfallIdentifier[],
  ): Promise<CollectionResult> {
    const found: ScryfallCard[] = [];
    const notFound: ScryfallIdentifier[] = [];
    let requests = 0;

    const batches = chunk(identifiers, MAX_IDENTIFIERS_PER_REQUEST);
    for (const [index, batch] of batches.entries()) {
      // Space out requests, but never pay the delay before the first one.
      if (index > 0) await sleep(delayMs);

      const response = await fetchImpl(`${baseUrl}/cards/collection`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': userAgent,
        },
        body: JSON.stringify({ identifiers: batch }),
      });
      requests += 1;

      if (!response.ok) {
        throw new ScryfallError(
          `Scryfall request failed with status ${response.status}`,
          response.status,
        );
      }

      const payload = (await response.json()) as ScryfallCollectionResponse;
      found.push(...(payload.data ?? []));
      notFound.push(...(payload.not_found ?? []));
    }

    return { found, notFound, requests };
  }

  return { fetchCollection };
}
