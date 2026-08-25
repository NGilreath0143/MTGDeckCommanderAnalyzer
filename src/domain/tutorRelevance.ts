import { stripReminder } from './cardText';
import { cardTypes } from './cardFacts';
import { classifyCardRoles } from './roles';
import { classifyCardTags } from './tags';
import { cardHasPower } from './powerCards';
import { COLOR_CODES, type CardTag, type CardType, type ColorCode, type ResolvedCard } from './types';

/**
 * Deterministic tutor-relevance evidence. Pure.
 *
 * Answers "can this tutor actually FIND anything that matters?" rather than
 * merely counting tutors. Raw tutor count is a poor consistency signal: a
 * Mystical Tutor in a creature-combo deck finds none of its pieces.
 *
 * Search constraints are parsed from oracle text using the same
 * "search your library for ..." shape Phase 2 already relies on, so no curated
 * tutor database is introduced.
 *
 * Phase 4A produces EVIDENCE ONLY: no Speed or power points are awarded here.
 */

/** What a tutor is allowed to find. */
export interface TutorConstraint {
  /** "search your library for a card" — no restriction at all. */
  unrestricted: boolean;
  types: CardType[];
  colors: ColorCode[];
  /**
   * A numeric or dynamic restriction the parser does not evaluate, such as
   * Recruiter of the Guard's "toughness 2 or less" or Chord of Calling's
   * "mana value X or less". Matches under such a constraint are POTENTIAL,
   * never confirmed.
   */
  unevaluatedRestriction: string | null;
  /** The captured search phrase, for diagnostics. */
  phrase: string;
}

/** How confidently a tutor can find a given card. */
export type TutorMatchConfidence = 'exact' | 'potential';

export interface TutorMatch {
  cardName: string;
  confidence: TutorMatchConfidence;
}

export interface TutorTarget {
  tutorName: string;
  efficient: boolean;
  /** Null when the card searches no library (Demonic Consultation, Tainted Pact). */
  constraint: TutorConstraint | null;
  findsComboPieces: TutorMatch[];
  findsWinConditions: TutorMatch[];
  findsPrimaryEngine: TutorMatch[];
}

export interface TutorRelevanceEvidence {
  tutors: TutorTarget[];
  /** Confirmed (exact) relevance only. */
  relevantTutorsForWin: number;
  relevantEfficientTutorsForWin: number;
  relevantTutorsForPrimaryEngine: number;
  /** Preserved separately so unevaluated restrictions stay visible. */
  potentialTutorsForWin: number;
  /** Tutors whose constraint semantics the parser does not support. */
  unsupportedConstraintTutors: string[];
}

const SEARCH_PHRASE =
  /\bsearch(?:es)?\s+(?:your|their|its owner's)?\s*(?:library|libraries)\s+for\s+([^.;]{0,80})/i;

const TYPE_WORDS: Readonly<Record<string, CardType>> = {
  creature: 'Creature',
  artifact: 'Artifact',
  enchantment: 'Enchantment',
  instant: 'Instant',
  sorcery: 'Sorcery',
  land: 'Land',
  planeswalker: 'Planeswalker',
  battle: 'Battle',
};

const COLOR_WORDS: Readonly<Record<string, ColorCode>> = {
  white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G',
};

/** Restrictions the parser recognises but cannot evaluate. */
const UNEVALUATED = [
  /\bmana value\b[^.]{0,30}\bor (?:less|greater)\b/i,
  /\btoughness \d+ or less\b/i,
  /\bpower \d+ or (?:less|greater)\b/i,
  /\bwith the same name\b/i,
  /\bnamed\b/i,
];

/**
 * Parse what a tutor may search for.
 *
 * Returns null when the card performs no library search, which is itself
 * reportable evidence rather than an error.
 */
export function parseTutorConstraint(card: ResolvedCard): TutorConstraint | null {
  const text = stripReminder(card.oracleText).split('\n//\n')[0] ?? '';
  const match = text.match(SEARCH_PHRASE);
  if (!match) return null;

  const phrase = (match[1] ?? '').trim();
  const lower = phrase.toLowerCase();

  const unevaluated = UNEVALUATED.find((re) => re.test(lower));
  const types = Object.keys(TYPE_WORDS)
    .filter((word) => new RegExp(`\\b${word}s?\\b`).test(lower))
    .map((word) => TYPE_WORDS[word]!);
  const colors = Object.keys(COLOR_WORDS)
    .filter((word) => new RegExp(`\\b${word}\\b`).test(lower))
    .map((word) => COLOR_WORDS[word]!);

  // "a card" / "up to two cards" with no type word is unrestricted.
  const unrestricted = types.length === 0 && colors.length === 0;

  return {
    unrestricted,
    types,
    colors,
    unevaluatedRestriction: unevaluated ? phrase : null,
    phrase,
  };
}

/**
 * Can `tutor` find `target`, and how confidently?
 *
 * Returns null when the constraint excludes the target outright.
 */
export function matchConfidence(
  constraint: TutorConstraint,
  target: ResolvedCard,
): TutorMatchConfidence | null {
  const targetTypes = cardTypes(target.typeLine);

  if (!constraint.unrestricted) {
    if (constraint.types.length > 0 && !constraint.types.some((t) => targetTypes.includes(t))) {
      return null;
    }
    if (
      constraint.colors.length > 0 &&
      !constraint.colors.some((c) => target.colorIdentity.includes(c))
    ) {
      return null;
    }
  }

  // A restriction the parser cannot evaluate downgrades the match.
  return constraint.unevaluatedRestriction === null ? 'exact' : 'potential';
}

export interface TutorRelevanceInput {
  /** Every card slot in the deck, commanders included. */
  cards: ResolvedCard[];
  /** Combo pieces actually present in the deck. */
  comboPieceNames: ReadonlySet<string>;
  /** Tags that functionally support the primary archetype. */
  primarySupportTags: readonly CardTag[];
}

/**
 * Build tutor-relevance evidence for a deck.
 *
 * Only EXACT matches increment the confirmed counters; potential matches are
 * preserved separately so an unevaluated numeric restriction never inflates
 * apparent consistency.
 */
export function extractTutorRelevance(input: TutorRelevanceInput): TutorRelevanceEvidence {
  const { cards, comboPieceNames, primarySupportTags } = input;

  const winConditions = cards.filter((c) => cardHasPower(c, 'win_condition'));
  const comboPieces = cards.filter((c) => comboPieceNames.has(c.name));
  const primaryEngine = cards.filter((c) => {
    if (primarySupportTags.length === 0) return false;
    const tags = new Set<CardTag>(classifyCardTags(c).assignments.map((a) => a.tag));
    return primarySupportTags.some((t) => tags.has(t));
  });

  const tutors: TutorTarget[] = [];
  const unsupportedConstraintTutors: string[] = [];

  for (const card of cards) {
    const isTutor = classifyCardRoles(card).assignments.some((a) => a.role === 'tutor');
    if (!isTutor) continue;

    const constraint = parseTutorConstraint(card);
    if (constraint === null) {
      // Searches nothing (Demonic Consultation, Tainted Pact): reported, not
      // special-cased.
      unsupportedConstraintTutors.push(card.name);
      tutors.push({
        tutorName: card.name,
        efficient: cardHasPower(card, 'efficient_tutor'),
        constraint: null,
        findsComboPieces: [],
        findsWinConditions: [],
        findsPrimaryEngine: [],
      });
      continue;
    }

    const collect = (targets: ResolvedCard[]): TutorMatch[] => {
      const matches: TutorMatch[] = [];
      for (const t of targets) {
        if (t.name === card.name) continue; // a tutor does not find itself
        const confidence = matchConfidence(constraint, t);
        if (confidence) matches.push({ cardName: t.name, confidence });
      }
      return matches;
    };

    tutors.push({
      tutorName: card.name,
      efficient: cardHasPower(card, 'efficient_tutor'),
      constraint,
      findsComboPieces: collect(comboPieces),
      findsWinConditions: collect(winConditions),
      findsPrimaryEngine: collect(primaryEngine),
    });
  }

  const hasExact = (matches: TutorMatch[]) => matches.some((m) => m.confidence === 'exact');
  const hasPotentialOnly = (matches: TutorMatch[]) =>
    !hasExact(matches) && matches.some((m) => m.confidence === 'potential');

  const winRelevant = (t: TutorTarget) =>
    hasExact(t.findsWinConditions) || hasExact(t.findsComboPieces);

  return {
    tutors,
    relevantTutorsForWin: tutors.filter(winRelevant).length,
    relevantEfficientTutorsForWin: tutors.filter((t) => t.efficient && winRelevant(t)).length,
    relevantTutorsForPrimaryEngine: tutors.filter((t) => hasExact(t.findsPrimaryEngine)).length,
    potentialTutorsForWin: tutors.filter(
      (t) => !winRelevant(t) &&
        (hasPotentialOnly(t.findsWinConditions) || hasPotentialOnly(t.findsComboPieces)),
    ).length,
    unsupportedConstraintTutors,
  };
}

/** Exposed for tests and reporting. */
export const TUTOR_COLORS: readonly ColorCode[] = COLOR_CODES;
