import { normalizeCardName } from './normalizeName';
import type { DeckComposition, ResolvedCard } from './types';

/**
 * Curated compact-combo knowledge. Pure data plus matching.
 *
 * Oracle text cannot reliably express that two specific cards form a loop, so
 * combo identity is curated, reviewable knowledge rather than inferred. This
 * set is deliberately small; it is not a combo database.
 *
 * A combo need not win by itself — infinite mana and resource loops qualify,
 * with the outcome recorded in `result`.
 */

export type ComboResult =
  | 'immediate_win'
  | 'deterministic_win'
  | 'infinite_mana'
  | 'infinite_damage'
  | 'infinite_etb'
  | 'infinite_ltb'
  | 'deck_loop'
  | 'infinite_resource'
  | 'major_advantage'
  | 'other';

/**
 * Objective requirements to execute, never a subjective setup score.
 */
export type WinRequirement =
  | 'board_state'
  | 'mana'
  | 'life_total'
  | 'graveyard'
  | 'library'
  | 'additional_outlet'
  | 'combat'
  | 'delayed_trigger'
  | 'other';

export interface KnownComboPiece {
  name: string;
  /** Preferred stable identity when known; name is the readable fallback. */
  oracleId?: string;
}

export interface KnownCombo {
  id: string;
  pieces: readonly KnownComboPiece[];
  result: ComboResult;
  requirements?: readonly WinRequirement[];
  /** Why this is a combo, for reviewers. */
  note?: string;
}

export const KNOWN_COMBOS: readonly KnownCombo[] = [
  {
    id: 'thassas-oracle+demonic-consultation',
    pieces: [{ name: "Thassa's Oracle" }, { name: 'Demonic Consultation' }],
    result: 'immediate_win',
    requirements: ['library'],
    note: 'Exile the library, then Oracle wins on resolution.',
  },
  {
    id: 'thassas-oracle+tainted-pact',
    pieces: [{ name: "Thassa's Oracle" }, { name: 'Tainted Pact' }],
    result: 'immediate_win',
    requirements: ['library'],
    note: 'Same shell as Consultation; requires singleton library.',
  },
  {
    id: 'heliod+walking-ballista',
    pieces: [{ name: 'Heliod, Sun-Crowned' }, { name: 'Walking Ballista' }],
    result: 'infinite_damage',
    requirements: ['board_state', 'mana'],
    note: 'Lifelink plus counter placement loops damage.',
  },
  {
    id: 'kiki-jiki+zealous-conscripts',
    pieces: [{ name: 'Kiki-Jiki, Mirror Breaker' }, { name: 'Zealous Conscripts' }],
    result: 'infinite_etb',
    requirements: ['board_state'],
    note: 'Untap loop producing unbounded hasty bodies.',
  },
  {
    id: 'exquisite-blood+sanguine-bond',
    pieces: [{ name: 'Exquisite Blood' }, { name: 'Sanguine Bond' }],
    result: 'deterministic_win',
    requirements: ['board_state'],
    note: 'Any single life-loss event starts an unbounded drain loop.',
  },
  {
    id: 'isochron-scepter+dramatic-reversal',
    pieces: [{ name: 'Isochron Scepter' }, { name: 'Dramatic Reversal' }],
    result: 'infinite_mana',
    requirements: ['board_state', 'additional_outlet'],
    note: 'Infinite mana only with enough nonland mana sources.',
  },
  {
    id: 'underworld-breach+leds+brain-freeze',
    pieces: [
      { name: 'Underworld Breach' },
      { name: "Lion's Eye Diamond" },
      { name: 'Brain Freeze' },
    ],
    result: 'deterministic_win',
    requirements: ['graveyard', 'mana'],
    note: 'Escape loop milling opponents out.',
  },
  {
    id: 'basalt-monolith+rings-of-brighthearth',
    pieces: [{ name: 'Basalt Monolith' }, { name: 'Rings of Brighthearth' }],
    result: 'infinite_mana',
    requirements: ['mana'],
    note: 'Copying the untap ability nets unbounded colorless mana.',
  },
];

/** Where a matched combo piece was found. */
export interface DetectedComboPiece {
  name: string;
  location: 'command_zone' | 'mainboard' | 'library';
  /** Printed mana value from card facts; absent when not in the deck. */
  printedManaValue?: number;
}

export interface DetectedCombo {
  id: string;
  result: ComboResult;
  requirements: readonly WinRequirement[];
  /**
   * True only when every required piece is in the deck or command zone.
   * Partial matches are retained as progress evidence but must never be
   * counted as a detected combo.
   */
  complete: boolean;
  comboSize: number;
  piecesInCommandZone: number;
  piecesInMainboard: number;
  piecesNeededFromLibrary: number;
  /**
   * Summed printed mana value of pieces present in the deck. Scryfall X
   * semantics are preserved: Walking Ballista is MV 0.
   */
  totalPrintedManaValue: number;
  /** Printed mana value of pieces still to be found. */
  libraryPiecePrintedManaValue: number;
  pieces: DetectedComboPiece[];
  note?: string;
}

/** Index a deck by normalized card name, recording where each card sits. */
function indexDeck(composition: DeckComposition): Map<
  string,
  { card: ResolvedCard; location: 'command_zone' | 'mainboard' }
> {
  const index = new Map<string, { card: ResolvedCard; location: 'command_zone' | 'mainboard' }>();
  // Commanders first: command-zone access materially changes consistency.
  for (const card of composition.commanders) {
    index.set(normalizeCardName(card.name), { card, location: 'command_zone' });
  }
  for (const { card } of composition.mainboard) {
    const k = normalizeCardName(card.name);
    if (!index.has(k)) index.set(k, { card, location: 'mainboard' });
  }
  return index;
}

/**
 * Detect curated combos in a deck.
 *
 * A combo is reported when at least one piece is present, so partial packages
 * remain visible with `piecesNeededFromLibrary` recording the gap. Printed
 * mana values are DERIVED from the matched cards rather than stored.
 */
export function detectCombos(composition: DeckComposition): DetectedCombo[] {
  const index = indexDeck(composition);
  const detected: DetectedCombo[] = [];

  for (const combo of KNOWN_COMBOS) {
    const pieces: DetectedComboPiece[] = combo.pieces.map((piece) => {
      const found = index.get(normalizeCardName(piece.name));
      if (!found) return { name: piece.name, location: 'library' as const };
      return {
        name: found.card.name,
        location: found.location,
        printedManaValue: found.card.cmc,
      };
    });

    const present = pieces.filter((p) => p.location !== 'library');
    if (present.length === 0) continue;

    detected.push({
      id: combo.id,
      result: combo.result,
      requirements: combo.requirements ?? [],
      complete: present.length === combo.pieces.length,
      comboSize: combo.pieces.length,
      piecesInCommandZone: pieces.filter((p) => p.location === 'command_zone').length,
      piecesInMainboard: pieces.filter((p) => p.location === 'mainboard').length,
      piecesNeededFromLibrary: pieces.filter((p) => p.location === 'library').length,
      totalPrintedManaValue: present.reduce((sum, p) => sum + (p.printedManaValue ?? 0), 0),
      // Unknown for pieces not in the deck; kept as 0 rather than invented.
      libraryPiecePrintedManaValue: 0,
      pieces,
      ...(combo.note ? { note: combo.note } : {}),
    });
  }

  return detected;
}

export interface ComboOverlap {
  detectedCombos: number;
  uniqueComboPieces: number;
  /** Pieces appearing in more than one detected combo. */
  sharedComboPieces: number;
}

/**
 * Simple set overlap across detected combos.
 *
 * Oracle + Consultation together with Oracle + Tainted Pact gives 2 combos,
 * 3 unique pieces, and 1 shared piece. No combo graph is built.
 */
export function comboOverlap(detected: readonly DetectedCombo[]): ComboOverlap {
  const counts = new Map<string, number>();
  // Only complete combos represent an actual package in the deck.
  const complete = detected.filter((c) => c.complete);
  for (const combo of complete) {
    for (const piece of combo.pieces) {
      const k = normalizeCardName(piece.name);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return {
    detectedCombos: complete.length,
    uniqueComboPieces: counts.size,
    sharedComboPieces: [...counts.values()].filter((n) => n > 1).length,
  };
}
