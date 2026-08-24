import { readFileSync } from 'node:fs';
import type { ResolvedCard } from '@/domain/types';

/**
 * Real cards captured from the live Scryfall API, so role rules are tested
 * against genuine Oracle wording rather than hand-written approximations.
 *
 * Regenerate by re-fetching /cards/collection for these names.
 */
interface RoleCardFixture {
  name: string;
  typeLine: string;
  cmc: number | null;
  manaCost: string | null;
  keywords: string[];
  oracleId: string;
  oracleText: string;
}

const FIXTURES = JSON.parse(
  readFileSync('tests/fixtures/roleCards.json', 'utf8'),
) as Record<string, RoleCardFixture>;

/** A real card by its canonical Scryfall name. Throws if the fixture is absent. */
export function realCard(name: string): ResolvedCard {
  const c = FIXTURES[name];
  if (!c) throw new Error(`roleCards fixture is missing: ${name}`);
  return {
    scryfallId: `scry-${c.oracleId}`,
    oracleId: c.oracleId,
    name: c.name,
    manaCost: c.manaCost,
    cmc: c.cmc ?? 0,
    typeLine: c.typeLine,
    colorIdentity: [],
    colors: [],
    layout: c.typeLine.includes('//') ? 'modal_dfc' : 'normal',
    keywords: c.keywords,
    oracleText: c.oracleText,
    commanderLegality: 'legal',
  };
}

export function hasFixture(name: string): boolean {
  return name in FIXTURES;
}
