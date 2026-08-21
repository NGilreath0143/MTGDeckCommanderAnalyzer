import type { DeckSection, ParseError, ParsedDeck, ParsedLine } from './types';

/**
 * Decklist text parsing. Pure.
 *
 * Handles the formats decklists actually arrive in:
 *   1 Sol Ring            1x Sol Ring         Sol Ring
 *   1 Sol Ring [LTC]      1 Sol Ring (ltc) 123
 *   // comment            # comment           (blank lines)
 *   Commander:            SIDEBOARD           Deck / Mainboard
 *   1 Commander: Sol Ring  (inline tag, this line only)
 */

const SECTION_HEADERS: { pattern: RegExp; section: DeckSection }[] = [
  { pattern: /^(commanders?|commander\s*\(\d+\))$/i, section: 'commander' },
  { pattern: /^(sideboard|side\s*board|maybeboard)$/i, section: 'sideboard' },
  { pattern: /^(deck|mainboard|main\s*deck|main|creatures?|lands?|spells?)$/i, section: 'main' },
];

/**
 * A standalone section header, e.g. "Commander:" or "SIDEBOARD".
 * Returns null when the line is not a header.
 */
export function detectSectionHeader(raw: string): DeckSection | null {
  const trimmed = raw.trim().replace(/:$/, '').trim();
  if (!trimmed) return null;
  for (const { pattern, section } of SECTION_HEADERS) {
    if (pattern.test(trimmed)) return section;
  }
  return null;
}

/** Strip a trailing set code and collector number, returning both parts. */
function stripSetInfo(name: string): { name: string; setCode: string | null } {
  let working = name.trim();
  let setCode: string | null = null;

  // Trailing collector number: "Sol Ring 123" only when a set code preceded it.
  const bracketed = working.match(/^(.*?)\s*[[(]([A-Za-z0-9_]{2,6})[\])]\s*(\S+)?\s*$/);
  if (bracketed?.[1] !== undefined && bracketed[1].trim()) {
    working = bracketed[1].trim();
    setCode = (bracketed[2] ?? '').toUpperCase() || null;
  }

  // Trailing "*F*" foil markers and similar decorations.
  working = working.replace(/\s*\*[^*]*\*\s*$/, '').trim();

  return { name: working, setCode };
}

/**
 * Parse one line.
 * Returns null for blanks and comments, a ParseError for unusable content.
 */
export function parseLine(
  raw: string,
  lineNumber: number,
  section: DeckSection,
): ParsedLine | ParseError | null {
  const line = raw.replace(/\r$/, '').trim();
  if (!line) return null;
  if (/^(\/\/|#)/.test(line)) return null;

  // An inline "Commander:" tag applies to this line only.
  let lineSection = section;
  let body = line;
  const inlineTag = body.match(/^(?:(\d+)\s*[xX]?\s+)?(commander|sideboard)\s*:\s*(.+)$/i);
  if (inlineTag) {
    const tag = (inlineTag[2] ?? '').toLowerCase();
    lineSection = tag === 'commander' ? 'commander' : 'sideboard';
    body = `${inlineTag[1] ? `${inlineTag[1]} ` : ''}${inlineTag[3] ?? ''}`.trim();
  }

  /*
   * Quantity: "1", "1x", "1 x", or absent (implicitly 1).
   *
   * Capped at three digits so a card whose name starts with a year parses
   * correctly ("1996 World Champion"). Real decklist quantities are small,
   * and an explicit "x" ("1996x Foo") is still read as a quantity.
   */
  const qtyMatch =
    body.match(/^(\d+)\s*[xX]\s*(.+)$/) ?? body.match(/^(\d{1,3})\s+(.+)$/);
  let quantity = 1;
  let namePart = body;
  if (qtyMatch) {
    quantity = Number.parseInt(qtyMatch[1] ?? '1', 10);
    namePart = qtyMatch[2] ?? '';
  }

  if (quantity <= 0) {
    return { lineNumber, raw, reason: 'Quantity must be greater than zero' };
  }

  const { name, setCode } = stripSetInfo(namePart);
  if (!name) {
    return { lineNumber, raw, reason: 'Could not find a card name on this line' };
  }
  // A bare number, or a line with no letters, is not a card.
  if (!/\p{L}/u.test(name)) {
    return { lineNumber, raw, reason: 'Card name contains no letters' };
  }
  /*
   * Card names begin with a letter or digit ("Ratchet, Field Medic",
   * "Bösium Strip", "1996 World Champion"). A line opening with punctuation
   * is junk rather than a card, and must not be sent to Scryfall as a name.
   */
  if (!/^[\p{L}\p{N}]/u.test(name)) {
    return { lineNumber, raw, reason: 'Line does not look like a card name' };
  }

  return { raw, lineNumber, quantity, name, setCode, section: lineSection };
}

function isParseError(value: ParsedLine | ParseError): value is ParseError {
  return 'reason' in value;
}

/** Parse a full decklist. Section headers switch the active section. */
export function parseDecklist(text: string): ParsedDeck {
  const entries: ParsedLine[] = [];
  const errors: ParseError[] = [];
  let section: DeckSection = 'main';

  const lines = text.split('\n');
  for (const [index, rawLine] of lines.entries()) {
    const lineNumber = index + 1;
    const trimmed = rawLine.replace(/\r$/, '').trim();

    // A header only counts when it carries no card of its own.
    const header = detectSectionHeader(trimmed);
    if (header) {
      section = header;
      continue;
    }

    const result = parseLine(rawLine, lineNumber, section);
    if (result === null) continue;
    if (isParseError(result)) errors.push(result);
    else entries.push(result);
  }

  return { entries, errors };
}
