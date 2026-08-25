import { describe, expect, it } from 'vitest';
import { resolveCards } from '@/pipeline/resolveCards';
import { nameLookupKeys, normalizeCardName } from '@/domain/normalizeName';
import { makeFakeCardRepo } from './fakes';
import type { CollectionResult, ScryfallClient } from '@/infra/scryfall/client';
import type { ScryfallCard } from '@/infra/scryfall/types';

/**
 * Multi-face card resolution through the real ingestion path.
 *
 * The Phase 5A.2 corpus surfaced this: 26 of 38 analyzer-valid cEDH lists
 * contained a canonical `A // B` name and failed to resolve. The lists were
 * correct — `Birgi, God of Storytelling // Harnfel, Horn of Bounty` is exactly
 * what Scryfall calls that card.
 *
 * These tests use a client that mirrors the LIVE API's actual matching rule,
 * verified card-by-card against /cards/collection:
 *
 *   full "A // B"      -> NOT FOUND
 *   front face alone   -> FOUND, returning the full canonical name
 *
 * That holds for every multi-face family: modal DFCs, transforming DFCs,
 * pathway lands and split cards. It is the REVERSE of /cards/named, which
 * accepts either form — which is why the defect was not obvious.
 *
 * The shared `makeFakeScryfall` helper is deliberately not used here: it
 * accepts BOTH forms, which is more permissive than the real endpoint and
 * would hide the defect entirely.
 */

function scryfallCard(name: string, layout: string): ScryfallCard {
  const faces = name.split(' // ');
  return {
    id: `id-${name.toLowerCase().replace(/[^a-z]+/g, '-')}`,
    oracle_id: `oracle-${name.toLowerCase().replace(/[^a-z]+/g, '-')}`,
    name,
    mana_cost: layout === 'modal_dfc' ? '' : '{1}{R}',
    cmc: 2,
    type_line: faces.length > 1 ? 'Creature — God // Artifact' : 'Creature — Human',
    color_identity: ['R'],
    colors: ['R'],
    layout,
    keywords: [],
    oracle_text: 'Test text.',
    legalities: { commander: 'legal' },
    card_faces:
      faces.length > 1
        ? faces.map((f) => ({ name: f, type_line: 'Creature — God', oracle_text: 'Face text.' }))
        : undefined,
  } as unknown as ScryfallCard;
}

/** A client matching the live endpoint's exact-name-only behaviour. */
function makeStrictScryfall(catalogue: ScryfallCard[]) {
  const requestedNames: string[] = [];
  let requests = 0;
  const client: ScryfallClient = {
    async fetchCollection(identifiers) {
      if (identifiers.length === 0) return { found: [], notFound: [], requests: 0 };
      requests += 1;
      requestedNames.push(...identifiers.map((i) => i.name));
      const found: ScryfallCard[] = [];
      const notFound: typeof identifiers = [];
      for (const id of identifiers) {
        /*
         * Front-face-only matching, exactly like /cards/collection: the full
         * canonical `A // B` form is rejected.
         */
        const requested = normalizeCardName(id.name);
        const hit = catalogue.find((c) => {
          const front = normalizeCardName(c.name.split('//')[0] ?? c.name);
          return front === requested;
        });
        if (hit) found.push(hit);
        else notFound.push(id);
      }
      return { found, notFound, requests: 1 } satisfies CollectionResult;
    },

    /*
     * The fallback path. These fakes model /cards/collection's stricter
     * matching, so the fake `named` endpoint is deliberately no more
     * permissive than the collection one — it exists so the client shape is
     * satisfied and the fallback is exercised, not to invent extra hits.
     */
    async fetchNamed(name) {
      requests += 1;
      requestedNames.push(name);
      const key = normalizeCardName(name);
      const hit = catalogue.find((c) => {
        const canonical = normalizeCardName(c.name);
        const front = normalizeCardName(c.name.split('//')[0] ?? c.name);
        return canonical === key || front === key;
      });
      return { card: hit ?? null, requests: 1 };
    },
  };
  return { client, requestedNames, get requests() { return requests; } };
}

const BIRGI = 'Birgi, God of Storytelling // Harnfel, Horn of Bounty';
const SINK = 'Sink into Stupor // Soporific Springs';
const CATALOGUE = [
  scryfallCard(BIRGI, 'modal_dfc'),
  scryfallCard(SINK, 'modal_dfc'),
  scryfallCard('Sol Ring', 'normal'),
  scryfallCard('Lightning Bolt', 'normal'),
];

describe('canonical multi-face names are legitimate input', () => {
  it('derives both the full key and a front-face key', () => {
    // The lookup machinery already understands the shape.
    expect(nameLookupKeys(BIRGI)).toEqual([
      'birgi god of storytelling harnfel horn of bounty',
      'birgi god of storytelling',
    ]);
  });
});

describe('resolveCards with canonical multi-face names', () => {
  const deps = () => ({
    cardRepo: makeFakeCardRepo().repo,
    scryfall: makeStrictScryfall(CATALOGUE).client,
  });

  it('resolves an MDFC requested by its FULL canonical name', async () => {
    /*
     * The defect: the endpoint rejects this form, so resolution only succeeds
     * via the front-face retry. Every deck-export tool writes this form.
     */
    const r = await resolveCards([BIRGI], deps());
    expect(r.unresolvedNames).toEqual([]);
    expect(r.byName.get(normalizeCardName(BIRGI))?.name).toBe(BIRGI);
  });

  it('resolves an MDFC requested by its front face alone', async () => {
    const r = await resolveCards(['Birgi, God of Storytelling'], deps());
    expect(r.unresolvedNames).toEqual([]);
    expect(r.byName.get(normalizeCardName('Birgi, God of Storytelling'))?.name).toBe(BIRGI);
  });

  it('costs at most one extra request for the whole retry batch', async () => {
    // The retry is batched, not per-card.
    const fake = makeStrictScryfall(CATALOGUE);
    const r = await resolveCards([BIRGI, SINK, 'Sol Ring'], {
      cardRepo: makeFakeCardRepo().repo,
      scryfall: fake.client,
    });
    expect(r.unresolvedNames).toEqual([]);
    expect(fake.requests).toBe(2);
  });

  it('resolves a mixed request of single-face and multi-face names', async () => {
    const r = await resolveCards(['Sol Ring', BIRGI, SINK, 'Lightning Bolt'], deps());
    expect(r.unresolvedNames).toEqual([]);
    expect(r.byName.get(normalizeCardName(BIRGI))?.name).toBe(BIRGI);
    expect(r.byName.get(normalizeCardName(SINK))?.name).toBe(SINK);
    expect(r.byName.get(normalizeCardName('Sol Ring'))?.name).toBe('Sol Ring');
  });

  it('keeps a genuinely unknown name unresolved', async () => {
    // The repair must not turn a typo into a false match.
    const r = await resolveCards(['Definitely Not A Card // Nor This'], deps());
    expect(r.unresolvedNames).toEqual(['Definitely Not A Card // Nor This']);
  });

  it('does not degrade ordinary single-face resolution', async () => {
    const r = await resolveCards(['Sol Ring', 'Lightning Bolt'], deps());
    expect(r.unresolvedNames).toEqual([]);
    expect(r.stats.requested).toBe(2);
  });

  it('never returns the same card under a colliding wrong key', async () => {
    const r = await resolveCards([BIRGI, SINK], deps());
    const birgi = r.byName.get(normalizeCardName(BIRGI));
    const sink = r.byName.get(normalizeCardName(SINK));
    expect(birgi?.name).toBe(BIRGI);
    expect(sink?.name).toBe(SINK);
    expect(birgi).not.toBe(sink);
  });
});
