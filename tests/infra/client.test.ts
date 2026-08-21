import { describe, expect, it, vi } from 'vitest';
import {
  MAX_IDENTIFIERS_PER_REQUEST,
  ScryfallError,
  chunk,
  createScryfallClient,
} from '@/infra/scryfall/client';
import type { ScryfallIdentifier } from '@/infra/scryfall/types';

const jsonResponse = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as Response;

const ids = (n: number): ScryfallIdentifier[] =>
  Array.from({ length: n }, (_, i) => ({ name: `Card ${i}` }));

describe('chunk', () => {
  it.each([
    [0, 0],
    [1, 1],
    [75, 1],
    [76, 2],
    [150, 2],
    [151, 3],
  ])('splits %i items into %i chunks of 75', (count, expected) => {
    expect(chunk(ids(count), MAX_IDENTIFIERS_PER_REQUEST)).toHaveLength(expected);
  });

  it('keeps every item exactly once', () => {
    const items = ids(80);
    expect(chunk(items, 75).flat()).toEqual(items);
  });

  it('rejects a nonpositive size', () => {
    expect(() => chunk([1], 0)).toThrow(/positive/);
  });
});

describe('createScryfallClient', () => {
  it('sends one request for a small batch, with the required headers', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ object: 'list', data: [], not_found: [] }));
    const client = createScryfallClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      userAgent: 'TestAgent/1.0',
      sleep: async () => {},
    });

    const result = await client.fetchCollection(ids(3));

    expect(result.requests).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.scryfall.com/cards/collection');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['User-Agent']).toBe('TestAgent/1.0');
    expect(JSON.parse(init.body as string)).toEqual({ identifiers: ids(3) });
  });

  it('chunks 100 identifiers into two requests of 75 and 25', async () => {
    const bodies: number[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string).identifiers.length);
      return jsonResponse({ object: 'list', data: [], not_found: [] });
    });
    const client = createScryfallClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    });

    const result = await client.fetchCollection(ids(100));

    expect(bodies).toEqual([75, 25]);
    expect(result.requests).toBe(2);
  });

  it('waits between requests but not before the first', async () => {
    const delays: number[] = [];
    const fetchImpl = vi.fn(async () => jsonResponse({ object: 'list', data: [], not_found: [] }));
    const client = createScryfallClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      delayMs: 100,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });

    await client.fetchCollection(ids(160));

    // Three requests -> two waits.
    expect(delays).toEqual([100, 100]);
  });

  it('makes no request for an empty identifier list', async () => {
    const fetchImpl = vi.fn();
    const client = createScryfallClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await client.fetchCollection([]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toMatchObject({ found: [], notFound: [], requests: 0 });
  });

  it('merges found and not_found across batches', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      return call === 1
        ? jsonResponse({ object: 'list', data: [{ id: 'a', name: 'A' }], not_found: [{ name: 'X' }] })
        : jsonResponse({ object: 'list', data: [{ id: 'b', name: 'B' }], not_found: [{ name: 'Y' }] });
    });
    const client = createScryfallClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    });

    const result = await client.fetchCollection(ids(100));

    expect(result.found.map((c) => c.name)).toEqual(['A', 'B']);
    expect(result.notFound).toEqual([{ name: 'X' }, { name: 'Y' }]);
  });

  it('throws a ScryfallError carrying the status on failure', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'nope' }, 503));
    const client = createScryfallClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.fetchCollection(ids(1))).rejects.toBeInstanceOf(ScryfallError);
    await expect(client.fetchCollection(ids(1))).rejects.toMatchObject({ status: 503 });
  });
});
