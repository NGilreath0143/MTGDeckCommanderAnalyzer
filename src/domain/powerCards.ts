import { buildCardText, stripReminder, type CardText } from './cardText';
import { cardTypes, frontFace, isLand } from './cardFacts';
import type { ResolvedCard } from './types';

/**
 * Card-level power-relevant properties. Pure: no I/O, no LLM, no scoring.
 *
 * These REFINE the Phase 2 roles and Phase 3A tags rather than replacing them:
 * a card can be `interaction` (role) and additionally `efficient_interaction`
 * and `free_interaction` here.
 *
 * Two kinds of rule appear below, and the split is deliberate:
 *
 *  - GENERAL ORACLE RULES, used where behaviour is reliably readable from text
 *    (fast mana, free casting cost, repeatable card advantage, coverage).
 *  - CURATED SETS, used where the property is a format-level quality judgement
 *    that text cannot express. Measured example: efficient card advantage is
 *    not separable by mana value — at MV3 Rhystic Study qualifies while
 *    Phyrexian Arena does not; at MV4 The One Ring qualifies while Harmonize
 *    does not. Curated lists are kept small and are asserted by tests.
 */

export type PowerProperty =
  | 'fast_mana'
  | 'efficient_tutor'
  | 'efficient_interaction'
  | 'free_interaction'
  | 'efficient_protection'
  | 'efficient_card_advantage'
  | 'repeatable_card_advantage'
  | 'combo_piece'
  | 'win_condition';

export const POWER_PROPERTIES: readonly PowerProperty[] = [
  'fast_mana',
  'efficient_tutor',
  'efficient_interaction',
  'free_interaction',
  'efficient_protection',
  'efficient_card_advantage',
  'repeatable_card_advantage',
  'combo_piece',
  'win_condition',
];

/** One property assignment, naming the rule that produced it. */
export interface PowerPropertyAssignment {
  property: PowerProperty;
  ruleId: string;
}

export interface CardPowerAnalysis {
  cardId: string;
  assignments: PowerPropertyAssignment[];
}

// ---------------------------------------------------------------------------
// Curated sets
// ---------------------------------------------------------------------------

/**
 * Normalized name keys for curated lookups.
 *
 * Multi-faced cards are stored under their joined name ("Malakir Rebirth //
 * Malakir Mire"), so the front face must also match: curated lists name the
 * face players actually cast.
 */
function keysFor(name: string): string[] {
  const full = name.trim().toLowerCase();
  const front = (name.split('//')[0] ?? name).trim().toLowerCase();
  return front === full ? [full] : [full, front];
}

function key(name: string): string {
  return name.trim().toLowerCase();
}

/** True when any of the card's name keys appears in a curated set. */
function inCurated(set: ReadonlySet<string>, name: string): boolean {
  return keysFor(name).some((k) => set.has(k));
}

const curated = (...names: string[]): ReadonlySet<string> =>
  new Set(names.map(key));

/**
 * Tutors cheap and unrestricted enough to materially improve consistency.
 * Restriction alone does not disqualify (Worldly/Mystical Tutor are narrow but
 * efficient); cost and card-quality do.
 */
const EFFICIENT_TUTORS = curated(
  'Demonic Tutor',
  'Vampiric Tutor',
  'Imperial Seal',
  'Enlightened Tutor',
  'Worldly Tutor',
  'Mystical Tutor',
  'Gamble',
  'Diabolic Intent',
  'Entomb',
  "Green Sun's Zenith",
  'Chord of Calling',
  'Finale of Devastation',
  'Demonic Consultation',
  'Tainted Pact',
  'Recruiter of the Guard',
  'Birthing Pod',
);

/** Interaction that answers real threats for a low investment. */
const EFFICIENT_INTERACTION = curated(
  'Swords to Plowshares',
  'Path to Exile',
  'Pongify',
  'Rapid Hybridization',
  "Nature's Claim",
  'Chain of Vapor',
  'Swan Song',
  "An Offer You Can't Refuse",
  'Counterspell',
  'Mana Drain',
  'Daze',
  'Force of Will',
  'Force of Negation',
  'Fierce Guardianship',
  'Deflecting Swat',
  'Deadly Rollick',
);

/** Protection cheap enough to defend the plan without abandoning it. */
const EFFICIENT_PROTECTION = curated(
  "Tamiyo's Safekeeping",
  'Snakeskin Veil',
  "Tyvar's Stand",
  'Malakir Rebirth',
  'Feign Death',
  'Flawless Maneuver',
  'Deflecting Swat',
  'Fierce Guardianship',
  'Heroic Intervention',
  "Teferi's Protection",
  'Clever Concealment',
);

/**
 * Card advantage at a favourable rate. Curated because efficiency here is a
 * format judgement, not a mana-value threshold (see the module comment).
 */
const EFFICIENT_CARD_ADVANTAGE = curated(
  'Rhystic Study',
  'Mystic Remora',
  'Esper Sentinel',
  'The One Ring',
  'Necropotence',
  'Ad Nauseam',
  'Sylvan Library',
  'Black Market Connections',
  'Skullclamp',
  'Trouble in Pairs',
  "Night's Whisper",
  'Sign in Blood',
  'Painful Truths',
  'Fact or Fiction',
);

/**
 * Cards participating in a compact deterministic interaction. Combo identity
 * is relational knowledge, not oracle text, so it is curated and mirrors the
 * knownCombos seam.
 */
const COMBO_PIECES = curated(
  "Thassa's Oracle",
  'Demonic Consultation',
  'Tainted Pact',
  'Underworld Breach',
  "Lion's Eye Diamond",
  'Brain Freeze',
  'Isochron Scepter',
  'Dramatic Reversal',
  'Food Chain',
  'Dockside Extortionist',
  'Walking Ballista',
  'Heliod, Sun-Crowned',
  'Kiki-Jiki, Mirror Breaker',
  'Splinter Twin',
  'Exquisite Blood',
  'Sanguine Bond',
  'Basalt Monolith',
  'Rings of Brighthearth',
  'Zealous Conscripts',
);

/**
 * Cards that can directly convert a game state into a win.
 *
 * Deliberately distinct from combo_piece: Demonic Consultation is a combo
 * piece but wins nothing by itself, while Thassa's Oracle is both.
 */
const WIN_CONDITIONS = curated(
  "Thassa's Oracle",
  'Craterhoof Behemoth',
  'Approach of the Second Sun',
  'Triumph of the Hordes',
  'Torment of Hailfire',
  'Aetherflux Reservoir',
  'Laboratory Maniac',
  'Jace, Wielder of Mysteries',
  'Walking Ballista',
  /*
   * Reviewed additions. Each converts an ESTABLISHED state directly into a
   * closing outcome, rather than merely being a high-impact threat:
   *  - Purphoros turns an existing token board into damage with no combat.
   *  - Aurelia untaps the team and adds a combat, converting one enhanced
   *    creature into lethal.
   *  - Avenger converts an established land count into a lethal board on
   *    resolution.
   *
   * Deliberately NOT added after the same review: Myr Battlesphere (a strong
   * attacker, not a converter) and Etali (explosive card advantage, not a
   * closing outcome).
   */
  'Purphoros, God of the Forge',
  'Aurelia, the Warleader',
  'Avenger of Zendikar',
);

/** Sizes exposed for reporting, so curated surface area stays visible. */
export const CURATED_SET_SIZES: Readonly<Record<string, number>> = {
  efficient_tutor: EFFICIENT_TUTORS.size,
  efficient_interaction: EFFICIENT_INTERACTION.size,
  efficient_protection: EFFICIENT_PROTECTION.size,
  efficient_card_advantage: EFFICIENT_CARD_ADVANTAGE.size,
  combo_piece: COMBO_PIECES.size,
  win_condition: WIN_CONDITIONS.size,
};

// ---------------------------------------------------------------------------
// General oracle rules
// ---------------------------------------------------------------------------

/**
 * Mana produced by ONE activation.
 *
 * "Add {R} or {G}" is a choice of one mana, not two — miscounting that tagged
 * 392 lands as fast mana in review. Word amounts ("add two mana") count.
 */
function producedPerActivation(text: string): number {
  let best = 0;
  for (const m of text.matchAll(/\badd\b([^.\n]{0,70})/gi)) {
    const segment = m[1] ?? '';
    const symbols = (segment.match(/\{[WUBRGC]\}/g) ?? []).length;
    const isChoice = /\{[WUBRGC]\}\s*(?:,\s*)?\bor\b/i.test(segment);
    const words: Record<string, number> = {
      one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
    };
    const wordMatch = segment.match(/\b(one|two|three|four|five|six|seven)\s+mana\b/i);
    const wordAmount = wordMatch ? (words[wordMatch[1]!.toLowerCase()] ?? 0) : 0;
    best = Math.max(best, isChoice ? Math.max(1, wordAmount) : Math.max(symbols, wordAmount));
  }
  return best;
}

/**
 * A land is fast mana only when a single {T} activation (no extra mana cost)
 * immediately yields 2+ unrestricted mana with no external condition.
 *
 * Reviewed against all matches: this excludes storage lands (pay {1} per
 * counter over turns), filter lands ({1},{T}: add 2 is net-neutral), Urza
 * lands (need two other named lands), and gated lands such as Temple of the
 * False God. It keeps Ancient Tomb, City of Traitors, Crystal Vein and the
 * pay-on-entry lands.
 */
function fastManaLandRule(text: string): string | null {
  if (/\benters tapped\b/i.test(text)) return null;
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*\{T\}(?:,\s*Sacrifice this land)?\s*:\s*(.+)$/i);
    if (!match) continue;
    const effect = match[1] ?? '';
    if (!/\badd\b/i.test(effect)) continue;
    // Conditional, replacement, or externally gated production is not "fast".
    if (/\bif you control\b|\bactivate only if\b|\binstead\b|\bmax speed\b/i.test(effect)) continue;
    // Narrowly restricted mana does not accelerate the general plan.
    if (/\bspend this mana only\b/i.test(effect)) continue;
    if (producedPerActivation(effect) >= 2) {
      return /sacrifice this land/i.test(line) ? 'land-sacrifice-burst' : 'land-above-rate';
    }
  }
  return null;
}

/**
 * Output bought with X or multikicker: printed mana value understates what the
 * card actually costs to produce its mana, so "produces more than it cost" is
 * not a valid reading (Everflowing Chalice, Astral Cornucopia).
 */
const SCALING_MANA_COST =
  /\bmultikicker\b|\benters with\b[^.]{0,60}\bcharge counters? on it for each\b|\bfor each\s+(?:charge|\+1\/\+1)?\s*counter on\b/i;

/**
 * An egg or filter: sacrificed to replace mana already spent, or to convert
 * mana rather than add to it. Recognised by a sacrifice cost that both adds
 * mana and draws/replaces, or that only converts colors.
 */
function isManaFilterEgg(text: string): boolean {
  for (const line of text.split('\n')) {
    if (!/\bsacrifice this\b/i.test(line)) continue;
    if (!/\badd\b/i.test(line)) continue;
    /*
     * An activation that itself costs mana is filtering, not acceleration:
     * Terrarion pays {2} to add two, Kaleidostone pays {5} to add five. Only
     * a free ({T} or bare sacrifice) activation actually accelerates.
     */
    const cost = line.split(':')[0] ?? '';
    if (/\{\d+\}|\{[WUBRG]\}/.test(cost)) return true;
    // Adding mana AND replacing the card is exchange, not acceleration.
    if (/\bdraw a card\b/i.test(line)) return true;
  }
  return false;
}

/** An alternative cost that replaces the mana cost entirely. */
const FREE_CAST_COST =
  /\brather than pay (?:this spell's|its) mana cost\b|\bwithout paying its mana cost\b/i;

/** Does this card interact with an opponent's resources at all? */
function isInteractionCard(text: CardText): boolean {
  return text.frontClauses.some((c) => {
    if (/\bgraveyard\b/i.test(c)) return false;
    return (
      /\bcounter target\b/i.test(c) ||
      /\b(?:destroy|exile)\s+(?:\w+\s+)?target\b/i.test(c) ||
      /\breturn target\b[^.]*\bto (?:its|their) owner'?s? hand\b/i.test(c)
    );
  });
}

const RECURRING_TRIGGER = /\b(?:whenever|at the beginning of)\b/i;
/** A repeatable activated ability (cost followed by a colon). */
const REPEATABLE_ACTIVATED = /(?:^|\n)[^:\n]{0,40}(?:\{[^}\n]+\}|Pay \d+ life)[^:\n]{0,30}:/m;
/** Acquiring cards: drawing, or the impulse shape the draw rule also accepts. */
const ACQUIRES_CARDS = /\bdraw\b|\bexile the top card of your library\b/i;

/*
 * --- repeatable-advantage guards ---------------------------------------
 *
 * All three operate on ONE ability line, never the whole card. A guard applied
 * globally would suppress a legitimate engine because of unrelated text
 * elsewhere: Sphinx's Tutelage loots on one line while triggering on another.
 */

/**
 * The activation cost consumes the source, so the ability resolves once. Mind
 * Stone, Relic of Progenitus and the Spellbomb/Cluestone families all read
 * "{cost}, Sacrifice this artifact: Draw a card" and are one-shot replacement,
 * not engines.
 */
const SELF_CONSUMING_ACTIVATION =
  /^[^:\n]{0,60}\b(?:Sacrifice|Exile)\s+(?:this|~)\b[^:\n]{0,40}:/i;

/**
 * Loot/rummage parity: the clause draws and discards in equal measure, so the
 * card delta is zero. This is card flow, which Consistency measures elsewhere,
 * not net advantage. A strictly positive delta ("draw three, then discard
 * one") still qualifies.
 */
const LOOT_PARITY =
  /\bdraws?\s+(a|one|two|three|four|five|\d+)\s+cards?,?\s+then\s+discards?\s+(a|one|two|three|four|five|\d+)\s+cards?\b/i;

/**
 * A symmetric clause that hands every player the same draw is not controller
 * advantage. The subject must be the one DRAWING: a possessive timing phrase
 * does not count, which is what keeps Wavebreak Hippocamp ("during each
 * opponent's turn ... draw a card") credited as the asymmetric engine it is.
 */
const SYMMETRIC_DRAW =
  /\beach (?:player|opponent)\b(?!'s)[^.]{0,60}?\bdraws?\b|\bthat player draws\b/i;

const WORD_COUNTS: Record<string, number> = {
  a: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
};
const cardCount = (token: string): number =>
  WORD_COUNTS[token.toLowerCase()] ?? Number.parseInt(token, 10);

/**
 * Does this one ability line provide REPEATED card acquisition for its
 * controller? Returns false for single-use activations, parity looting, and
 * symmetric draws.
 */
function isRepeatableAdvantageLine(line: string): boolean {
  const triggered = RECURRING_TRIGGER.test(line);
  const activated = REPEATABLE_ACTIVATED.test(`\n${line}`);
  if (!triggered && !activated) return false;
  if (!ACQUIRES_CARDS.test(line)) return false;

  // A triggered ability is never paid for by consuming the source.
  if (activated && !triggered && SELF_CONSUMING_ACTIVATION.test(line)) return false;

  const parity = line.match(LOOT_PARITY);
  if (parity && cardCount(parity[1] ?? '') <= cardCount(parity[2] ?? '')) return false;

  // "you draw" marks the controller as a beneficiary even in a shared clause.
  if (SYMMETRIC_DRAW.test(line) && !/\byou draw\b/i.test(line)) return false;

  return true;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

interface PowerRule {
  id: string;
  property: PowerProperty;
  matches(card: ResolvedCard, text: CardText): boolean;
}

const POWER_RULES: PowerRule[] = [
  // === fast_mana (general oracle rule) ==================================
  {
    // Mana from hand without casting anything (Simian Spirit Guide).
    id: 'free-from-hand-mana',
    property: 'fast_mana',
    matches: (_card, text) =>
      /\bexile this card from your hand\b/i.test(text.front) &&
      producedPerActivation(text.front) >= 1,
  },
  {
    // Burst Treasure creation (Dockside Extortionist).
    id: 'treasure-burst',
    property: 'fast_mana',
    matches: (_card, text) => /\bcreate x treasure tokens\b/i.test(text.front),
  },
  {
    id: 'fast-mana-land',
    property: 'fast_mana',
    matches: (card, text) => isLand(card) && fastManaLandRule(text.front) !== null,
  },
  {
    /*
     * Nonland acceleration producing strictly more mana than it cost. This is
     * what separates fast mana from ordinary ramp: Sol Ring (MV1 -> 2) and
     * Dark Ritual (MV1 -> 3) qualify, while Arcane Signet (MV2 -> 1) and
     * Birds of Paradise (MV1 -> 1) do not.
     *
     * Two exclusions come from corpus review, because both describe eventual
     * mana after investment rather than immediate acceleration:
     *  - scaling rocks whose output is bought with X or multikicker
     *    (Everflowing Chalice, Astral Cornucopia) — printed MV understates
     *    the real cost, so the "net positive" reading is false;
     *  - eggs and filters that must be sacrificed to replace mana already
     *    spent (Terrarion, Skycloud Egg), which is exchange, not acceleration.
     */
    id: 'net-positive-mana',
    property: 'fast_mana',
    matches: (card, text) => {
      if (isLand(card)) return false;
      if (producedPerActivation(text.front) <= card.cmc) return false;
      if (SCALING_MANA_COST.test(text.front)) return false;
      if (isManaFilterEgg(text.front)) return false;
      return true;
    },
  },

  // === free_interaction =================================================
  {
    /*
     * Free interaction requires interaction semantics FIRST, then a free cost.
     * Flawless Maneuver has a free cost but only protects, so it must not be
     * counted as interaction.
     */
    id: 'free-cast-interaction',
    property: 'free_interaction',
    matches: (_card, text) =>
      FREE_CAST_COST.test(text.front) && isInteractionCard(text),
  },

  // === repeatable_card_advantage ========================================
  {
    /*
     * A permanent that draws across multiple events without being recast.
     * Instants and sorceries are excluded by type, which is what separates
     * Rhystic Study from Night's Whisper.
     */
    id: 'repeatable-draw-permanent',
    property: 'repeatable_card_advantage',
    matches: (card, text) => {
      const front = frontFace(card.typeLine);
      if (/\b(?:Instant|Sorcery)\b/i.test(front)) return false;
      if (!ACQUIRES_CARDS.test(text.front)) return false;
      if (!RECURRING_TRIGGER.test(text.front) && !REPEATABLE_ACTIVATED.test(text.front)) {
        return false;
      }

      /*
       * Judge each ability line separately. When no single line both repeats
       * and acquires — the ability is split across lines, or phrased in a way
       * the line split cannot see — fall back to the card-level answer rather
       * than silently dropping the card.
       */
      const lines = text.front.split('\n').filter((l) => l.trim());
      const candidates = lines.filter(
        (l) => (RECURRING_TRIGGER.test(l) || REPEATABLE_ACTIVATED.test(`\n${l}`)) && ACQUIRES_CARDS.test(l),
      );
      if (candidates.length === 0) return true;
      return candidates.some(isRepeatableAdvantageLine);
    },
  },

  // === curated properties ==============================================
  {
    id: 'curated-efficient-tutor',
    property: 'efficient_tutor',
    matches: (card) => inCurated(EFFICIENT_TUTORS, card.name),
  },
  {
    id: 'curated-efficient-interaction',
    property: 'efficient_interaction',
    matches: (card) => inCurated(EFFICIENT_INTERACTION, card.name),
  },
  {
    id: 'curated-efficient-protection',
    property: 'efficient_protection',
    matches: (card) => inCurated(EFFICIENT_PROTECTION, card.name),
  },
  {
    id: 'curated-efficient-card-advantage',
    property: 'efficient_card_advantage',
    matches: (card) => inCurated(EFFICIENT_CARD_ADVANTAGE, card.name),
  },
  {
    id: 'curated-combo-piece',
    property: 'combo_piece',
    matches: (card) => inCurated(COMBO_PIECES, card.name),
  },
  {
    id: 'curated-win-condition',
    property: 'win_condition',
    matches: (card) => inCurated(WIN_CONDITIONS, card.name),
  },
];

/** Classify one card's power properties, preserving rule provenance. */
export function analyzeCardPower(card: ResolvedCard): CardPowerAnalysis {
  const text = buildCardText(card);
  return {
    cardId: card.scryfallId,
    assignments: POWER_RULES.filter((rule) => rule.matches(card, text)).map((rule) => ({
      property: rule.property,
      ruleId: rule.id,
    })),
  };
}

export function cardHasPower(card: ResolvedCard, property: PowerProperty): boolean {
  return analyzeCardPower(card).assignments.some((a) => a.property === property);
}

// ---------------------------------------------------------------------------
// Shared derivations used by the deck-level evidence module
// ---------------------------------------------------------------------------

/** Interaction target categories a single card can answer. */
export type InteractionTarget =
  | 'creature'
  | 'artifact'
  | 'enchantment'
  | 'planeswalker'
  | 'land'
  | 'spell'
  | 'graveyard';

const TARGET_PATTERNS: Readonly<Record<InteractionTarget, RegExp>> = {
  creature: /\btarget creature\b|\ball creatures\b|\beach creature\b/i,
  artifact: /\btarget artifact\b|\ball artifacts\b|\beach artifact\b/i,
  enchantment: /\btarget enchantment\b|\ball enchantments\b/i,
  planeswalker: /\btarget planeswalker\b|\ball planeswalkers\b/i,
  land: /\btarget (?:nonbasic )?land\b|\ball lands\b/i,
  spell: /\bcounter target\b/i,
  graveyard: /\bexile\b[^.]{0,40}\bgraveyard\b|\bgraveyards?\b[^.]{0,30}\bexile\b/i,
};

/**
 * Which target categories a card covers. One modal card counts once toward
 * total interaction but may cover several categories (Abrade covers creature
 * and artifact).
 */
export function interactionTargets(card: ResolvedCard): InteractionTarget[] {
  const text = buildCardText(card).front;
  const covered = (Object.keys(TARGET_PATTERNS) as InteractionTarget[]).filter((t) =>
    TARGET_PATTERNS[t].test(text),
  );
  // A generic nonland-permanent answer covers the permanent categories.
  if (/\btarget (?:nonland )?permanent\b/i.test(text)) {
    for (const t of ['creature', 'artifact', 'enchantment', 'planeswalker'] as const) {
      if (!covered.includes(t)) covered.push(t);
    }
  }
  return covered;
}

export function isCounterspell(card: ResolvedCard): boolean {
  return /\bcounter target\b/i.test(buildCardText(card).front);
}

/** True when the card's cost can be replaced entirely. */
export function hasFreeCastCost(card: ResolvedCard): boolean {
  return FREE_CAST_COST.test(stripReminder(card.oracleText));
}

/** Exposed for the stax module and tests. */
export function isPlaneswalkerCard(card: ResolvedCard): boolean {
  return cardTypes(card.typeLine).includes('Planeswalker');
}
