import { beforeAll } from 'vitest';

/**
 * Guard: no test may make a real network request. The Scryfall client takes
 * an injectable `fetchImpl`, so any call landing here is a mistake.
 */
beforeAll(() => {
  globalThis.fetch = (async (input: unknown) => {
    throw new Error(`Unexpected real network request in tests: ${String(input)}`);
  }) as typeof fetch;
});
