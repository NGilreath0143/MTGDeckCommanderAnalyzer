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

  /*
   * Trailing "*F*" foil markers and similar decorations come off FIRST.
   *
   * Exports put the decoration AFTER the collector number
   * ("1 Mesa Enchantress (PLC) 26 *F*"), and the set-info pattern below is
   * anchored at end-of-string. Stripping in the other order left the marker
   * in place, the anchor failed, and the whole "(PLC) 26" stayed glued to the
   * name — every foil line resolved as a miss.
   */
  working = working.replace(/\s*\*[^*]*\*\s*$/, '').trim();

  // Trailing collector number: "Sol Ring 123" only when a set code preceded it.
  const bracketed = working.match(/^(.*?)\s*[[(]([A-Za-z0-9_]{2,6})[\])]\s*(\S+)?\s*$/);
  if (bracketed?.[1] !== undefined && bracketed[1].trim()) {
    working = bracketed[1].trim();
    setCode = (bracketed[2] ?? '').toUpperCase() || null;
  }

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
   * The multiplier marker must be syntactically distinct from the first
   * letter of the card name, which is why there are two separate x-forms
   * rather than one permissive `\s*[xX]\s*`:
   *
   *   ADJACENT  "1x Sol Ring"    — the x touches the digit
   *   SPACED    "1 x Sol Ring"   — whitespace on BOTH sides of the x
   *
   * A single pattern allowing optional space on either side read
   * "1 Xenagos, God of Revels" as quantity 1 times "enagos, God of Revels",
   * silently corrupting all 27 Commander-legal cards whose name begins with
   * X (Xantid Swarm, Xanthic Statue, Xantcha, Xander's Lounge...). The spaced
   * form cannot match such a line because no whitespace follows the name's X.
   *
   * The plain form is capped at three digits so a card whose name starts with
   * a year parses correctly ("1996 World Champion"). An explicit x still
   * reads as a quantity at any width ("1996x Foo").
   */
  const qtyMatch =
    body.match(/^(\d+)[xX]\s*(.+)$/) ??
    body.match(/^(\d+)\s+[xX]\s+(.+)$/) ??
    body.match(/^(\d{1,3})\s+(.+)$/);
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
  /*
   * How many cards the current explicit `Commander` section has taken.
   *
   * MTGO, Arena and several deck sites export a commander block terminated by
   * a BLANK LINE rather than an explicit `Deck` header:
   *
   *     Commander
   *     1 Xenagos, God of Revels
   *                              <- blank
   *     1 Sol Ring
   *     ...
   *
   * Without this, section state never left `commander` and the whole
   * remaining list was read as commanders — 99 commanders, one
   * TOO_MANY_COMMANDERS error and ~60 spurious INVALID_COMMANDER errors.
   *
   * Scoped deliberately narrowly: only a `commander` section that has already
   * captured at least one card is closed this way. A blank line is NOT
   * globally equivalent to a `Deck` header, because decklists routinely carry
   * incidental blank lines inside the mainboard, and closing an arbitrary
   * section on one would change long-standing behaviour. Contiguous
   * commanders before the blank line are preserved, so partner and background
   * pairs still parse.
   */
  let commanderLinesTaken = 0;

  const lines = text.split('\n');
  for (const [index, rawLine] of lines.entries()) {
    const lineNumber = index + 1;
    const trimmed = rawLine.replace(/\r$/, '').trim();

    if (trimmed === '') {
      if (section === 'commander' && commanderLinesTaken > 0) {
        section = 'main';
        commanderLinesTaken = 0;
      }
      continue;
    }

    // A header only counts when it carries no card of its own.
    const header = detectSectionHeader(trimmed);
    if (header) {
      section = header;
      commanderLinesTaken = 0;
      continue;
    }

    const result = parseLine(rawLine, lineNumber, section);
    if (result === null) continue;
    if (isParseError(result)) errors.push(result);
    else {
      entries.push(result);
      if (result.section === 'commander') commanderLinesTaken += 1;
    }
  }

  return { entries, errors };
}
