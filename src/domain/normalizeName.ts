/**
 * Card-name normalization. Pure.
 *
 * Scryfall canonicalizes names (a user typing "Nazgul" gets back "Nazgûl"),
 * so every cache lookup must be accent- and punctuation-insensitive.
 */

/**
 * Fold a card name to a stable lookup key: lowercase, strip diacritics,
 * drop punctuation, collapse whitespace.
 *
 * normalizeCardName("Nazgûl")      === normalizeCardName("Nazgul")
 * normalizeCardName("Urza's Saga") === "urzas saga"
 */
export function normalizeCardName(name: string): string {
  return name
    .normalize('NFKD')
    // Strip combining marks left behind by NFKD (the accents themselves).
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // Æ/æ and similar ligatures survive NFKD; map the ones that appear on cards.
    .replace(/æ/g, 'ae')
    .replace(/œ/g, 'oe')
    // Apostrophes join letters, so they are deleted: "Urza's" -> "urzas".
    .replace(/['\u2019\u02bc]/g, '')
    // Any other punctuation/symbol run becomes a separator rather than a
    // deletion, so "Snow-Covered" matches "Snow Covered" while "AB" != "A B".
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * The front face of a multi-faced name ("A // B" -> "A").
 *
 * Accepts a SINGLE-slash separator too ("A / B"), which several exporters
 * emit for DFCs and split cards. `/cards/collection` rejects both slash forms
 * outright — verified live: "Sejiri Shelter / Sejiri Glacier" and
 * "Brightclimb Pathway / Grimclimb Pathway" both come back in `not_found`,
 * while the bare front face resolves — so the front face is the only spelling
 * that reliably matches, and a single-slash list would otherwise lose every
 * one of its multi-face cards.
 *
 * The slash must be surrounded by whitespace. A bare "/" is left alone
 * because real card names contain one ("Fire // Ice" is always written with
 * the doubled form, but "Question Mark / Ampersand"-style names must not be
 * truncated at an internal slash).
 */
export function frontFaceName(name: string): string {
  const doubled = name.indexOf('//');
  if (doubled !== -1) return name.slice(0, doubled).trim();
  const single = name.match(/^(.*?)\s\/\s/);
  return single?.[1] !== undefined ? single[1].trim() : name.trim();
}

/**
 * All keys a card should be findable under: the full name and, for
 * multi-faced cards, the front face alone — users commonly type just
 * "Malakir Rebirth" for "Malakir Rebirth // Malakir Mire".
 *
 * Order is significant: the full-name key comes first.
 */
export function nameLookupKeys(name: string): string[] {
  const full = normalizeCardName(name);
  const front = normalizeCardName(frontFaceName(name));
  return front && front !== full ? [full, front] : [full];
}
