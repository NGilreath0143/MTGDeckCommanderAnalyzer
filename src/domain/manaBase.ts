import { stripReminder } from './cardText';
import { frontFace, isBasicLand, isLand, manaPips } from './cardFacts';
import { COLOR_CODES, type ColorCode, type DeckComposition, type ResolvedCard } from './types';

/**
 * Deterministic mana-base facts. Pure. No score is produced here.
 *
 * Color sources come from Scryfall's `produced_mana`, surfaced onto
 * ResolvedCard. That is not oracle-text derivable: only ~80% of
 * Commander-legal lands match a text rule, because duals and Triomes state
 * their mana ability entirely in parenthetical reminder text, which
 * reminder-stripping correctly removes.
 */

export type LandTappedState = 'untapped' | 'conditional' | 'tapped';

export interface ManaBaseFacts {
  landCount: number;
  /** Modal double-faced cards whose back face is a land, counted separately. */
  mdfcLandCount: number;
  landPercentage: number;

  alwaysUntappedLandCount: number;
  conditionalUntappedLandCount: number;
  entersTappedLandCount: number;

  manaProducingLands: number;
  nonManaLands: number;
  colorlessOnlyLandCount: number;
  utilityLandCount: number;

  whiteSources: number;
  blueSources: number;
  blackSources: number;
  redSources: number;
  greenSources: number;
  colorlessSources: number;

  singleColorSources: number;
  multiColorSources: number;
  anyColorSources: number;

  fetchLandCount: number;
  /** Lands actually fetchable by the deck's fetchlands. */
  fetchableLandCount: number;

  whitePips: number;
  bluePips: number;
  blackPips: number;
  redPips: number;
  greenPips: number;

  /** Early color demands such as "UU at MV2". */
  demandingEarlyCosts: string[];
}

/** A land's back face on a modal double-faced card. */
function isMdfcLand(card: ResolvedCard): boolean {
  if (!card.typeLine.includes('//')) return false;
  const back = card.typeLine.split('//')[1] ?? '';
  return /\bLand\b/i.test(back);
}

/**
 * Whether a land enters untapped, conditionally untapped, or tapped.
 *
 * "enters tapped unless ..." is conditional (Glacial Fortress); a bare
 * "enters tapped" is tapped; anything else is untapped.
 */
export function landTappedState(card: ResolvedCard): LandTappedState {
  const text = stripReminder(card.oracleText);
  if (!/\benters tapped\b/i.test(text)) {
    // "As this land enters, you may pay 2 life" style shocklands.
    if (/\bas this land enters\b[^.]{0,60}\bpay \d+ life\b/i.test(text)) return 'conditional';
    return 'untapped';
  }
  if (/\benters tapped unless\b/i.test(text)) return 'conditional';
  if (/\bas this land enters\b[^.]{0,60}\bpay \d+ life\b/i.test(text)) return 'conditional';
  return 'tapped';
}

/** A land that searches the library for other lands. */
export function isFetchLand(card: ResolvedCard): boolean {
  if (!isLand(card)) return false;
  return /\bsearch your library for\b[^.]{0,80}?\bland\b|\bsearch your library for a[n]?\s+\w+(?:\s+or\s+\w+)?\s+card\b/i.test(
    stripReminder(card.oracleText),
  );
}

/**
 * Land subtypes a fetchland searches for, e.g. Windswept Heath -> Forest,
 * Plains. Used to resolve fetch color access against the actual deck.
 */
function fetchTargets(card: ResolvedCard): string[] {
  const text = stripReminder(card.oracleText);
  const match = text.match(/\bsearch your library for an?\s+([^.]{0,60}?)\s+card\b/i);
  if (!match) return [];
  return (match[1] ?? '')
    .split(/\s+or\s+|,\s*/)
    .map((s) => s.trim())
    .filter((s) => /^(?:Plains|Island|Swamp|Mountain|Forest|Gate|Desert|Cave|Locus|Sphere)$/i.test(s));
}

/** Colors a land actually produces, from Scryfall data. */
function producedColors(card: ResolvedCard): ColorCode[] {
  return card.producedMana ?? [];
}

export function extractManaBaseFacts(composition: DeckComposition): ManaBaseFacts {
  const mainboard = composition.mainboard;
  const totalCards = mainboard.reduce((sum, e) => sum + e.quantity, 0);

  const landEntries = mainboard.filter((e) => isLand(e.card));
  const landCount = landEntries.reduce((sum, e) => sum + e.quantity, 0);
  const mdfcLandCount = mainboard
    .filter((e) => !isLand(e.card) && isMdfcLand(e.card))
    .reduce((sum, e) => sum + e.quantity, 0);

  const tally = { untapped: 0, conditional: 0, tapped: 0 };
  const sources: Record<ColorCode | 'C', number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  let manaProducing = 0;
  let colorlessOnly = 0;
  let singleColor = 0;
  let multiColor = 0;
  let anyColor = 0;
  let fetchLands = 0;
  const fetchTypesWanted = new Set<string>();

  for (const { card, quantity } of landEntries) {
    tally[landTappedState(card)] += quantity;

    const colors = producedColors(card);
    if (colors.length > 0 || /\badd\b/i.test(stripReminder(card.oracleText))) {
      manaProducing += quantity;
    }
    for (const c of colors) sources[c] += quantity;
    if (colors.length === 0) {
      // Colorless-only producers still count as a source of {C}.
      if (/\badd\b[^.]{0,30}\{C\}/i.test(stripReminder(card.oracleText))) {
        sources.C += quantity;
        colorlessOnly += quantity;
      }
    } else if (colors.length === 1) singleColor += quantity;
    else if (colors.length >= 5) anyColor += quantity;
    else multiColor += quantity;

    if (isFetchLand(card)) {
      fetchLands += quantity;
      for (const t of fetchTargets(card)) fetchTypesWanted.add(t.toLowerCase());
    }
  }

  /*
   * Fetchland color access must be resolved against what the deck can actually
   * fetch. Windswept Heath produces no mana itself, so counting it as two
   * colors would overstate the mana base.
   */
  const fetchableLandCount = landEntries
    .filter(({ card }) => {
      const front = frontFace(card.typeLine).toLowerCase();
      return [...fetchTypesWanted].some((t) => front.includes(t));
    })
    .reduce((sum, e) => sum + e.quantity, 0);

  // Color demand from every nonland card in the deck.
  const pips: Record<ColorCode | 'C', number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  const demanding: string[] = [];
  for (const { card, quantity } of mainboard) {
    if (isLand(card)) continue;
    const cardPips = manaPips(card.manaCost);
    for (const c of COLOR_CODES) pips[c] += cardPips[c] * quantity;
    // Two or more of one color at MV<=3 is a genuine early strain.
    if (card.cmc <= 3) {
      for (const c of COLOR_CODES) {
        if (cardPips[c] >= 2) demanding.push(`${c.repeat(cardPips[c])} at MV${card.cmc}`);
      }
    }
  }

  const nonManaLands = landCount - manaProducing;
  return {
    landCount,
    mdfcLandCount,
    landPercentage: totalCards === 0 ? 0 : Math.round((landCount / totalCards) * 1000) / 1000,
    alwaysUntappedLandCount: tally.untapped,
    conditionalUntappedLandCount: tally.conditional,
    entersTappedLandCount: tally.tapped,
    manaProducingLands: manaProducing,
    nonManaLands,
    colorlessOnlyLandCount: colorlessOnly,
    // A utility land is one that produces no mana, or a nonbasic with an extra ability.
    utilityLandCount: landEntries
      .filter(({ card }) => !isBasicLand(card) && /\n/.test(stripReminder(card.oracleText).trim()))
      .reduce((sum, e) => sum + e.quantity, 0),
    whiteSources: sources.W,
    blueSources: sources.U,
    blackSources: sources.B,
    redSources: sources.R,
    greenSources: sources.G,
    colorlessSources: sources.C,
    singleColorSources: singleColor,
    multiColorSources: multiColor,
    anyColorSources: anyColor,
    fetchLandCount: fetchLands,
    fetchableLandCount,
    whitePips: pips.W,
    bluePips: pips.U,
    blackPips: pips.B,
    redPips: pips.R,
    greenPips: pips.G,
    demandingEarlyCosts: [...new Set(demanding)].sort(),
  };
}
