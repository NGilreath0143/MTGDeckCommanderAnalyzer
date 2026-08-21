import { normalizeCardName } from '@/domain/normalizeName';
import { COLOR_CODES, type ColorCode, type Legality } from '@/domain/types';
import type { ScryfallCard } from './types';

/**
 * Scryfall payload -> database insert shape. Pure.
 *
 * Deliberately does NOT produce a ResolvedCard: mapCardRow is the only
 * producer of that type, so a freshly fetched card and a cached card reach
 * the domain by an identical path and can never differ.
 */

export interface CardRecordInput {
  scryfallId: string;
  oracleId: string;
  name: string;
  normalizedName: string;
  manaCost: string | null;
  cmc: number;
  typeLine: string;
  colorIdentity: string[];
  colors: string[];
  layout: string;
  keywords: string[];
  oracleText: string;
  commanderLegality: string;
  scryfallJson: unknown;
}

const LEGALITIES = new Set<Legality>(['legal', 'not_legal', 'restricted', 'banned']);

function toLegality(value: string | undefined): Legality {
  return value && LEGALITIES.has(value as Legality) ? (value as Legality) : 'not_legal';
}

function toColors(values: string[] | undefined): ColorCode[] {
  if (!values) return [];
  return COLOR_CODES.filter((c) => values.includes(c));
}

/**
 * Oracle text, joining faces when the top level has none. Keeping both faces
 * matters: "can be your commander" can live on either side.
 */
export function extractOracleText(raw: ScryfallCard): string {
  if (raw.oracle_text) return raw.oracle_text;
  const faces = raw.card_faces ?? [];
  const texts = faces.map((f) => f.oracle_text ?? '').filter(Boolean);
  return texts.join('\n//\n');
}

/** Mana cost, falling back to the front face for multi-faced cards. */
export function extractManaCost(raw: ScryfallCard): string | null {
  if (raw.mana_cost) return raw.mana_cost;
  const front = raw.card_faces?.[0];
  return front?.mana_cost ?? null;
}

/** Type line, falling back to joining the faces. */
export function extractTypeLine(raw: ScryfallCard): string {
  if (raw.type_line) return raw.type_line;
  const faces = raw.card_faces ?? [];
  return faces.map((f) => f.type_line ?? '').filter(Boolean).join(' // ');
}

export function mapScryfallCard(raw: ScryfallCard): CardRecordInput {
  return {
    scryfallId: raw.id,
    // Rare, but reversible-print rows can omit oracle_id; fall back to the print id.
    oracleId: raw.oracle_id ?? raw.id,
    name: raw.name,
    normalizedName: normalizeCardName(raw.name),
    manaCost: extractManaCost(raw),
    // Top-level cmc is authoritative, including for modal DFCs.
    cmc: typeof raw.cmc === 'number' ? raw.cmc : 0,
    typeLine: extractTypeLine(raw),
    colorIdentity: toColors(raw.color_identity),
    colors: toColors(raw.colors),
    layout: raw.layout ?? 'normal',
    keywords: raw.keywords ?? [],
    oracleText: extractOracleText(raw),
    commanderLegality: toLegality(raw.legalities?.commander),
    scryfallJson: raw,
  };
}
