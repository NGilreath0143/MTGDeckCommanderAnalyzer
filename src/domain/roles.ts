import { isLand } from './cardFacts';
import {
  CARD_ROLES,
  type CardRole,
  type CardRoleAnalysis,
  type CardRoleAssignment,
  type DeckComposition,
  type DeckRoleProfile,
  type ResolvedCard,
} from './types';

/**
 * Deterministic card-role classification. Pure: no I/O, no LLM, no scoring.
 *
 * Rules are independent predicates, not a precedence chain — a card collects
 * every role it matches. The only deliberate exclusions are tutor-vs-selection
 * and land-development-search-vs-tutor.
 *
 * Design bias: rules are kept NARROW. A missed card (false negative) is
 * preferable to a misclassified one (false positive), because downstream
 * features would inherit false positives invisibly. The card examples this was
 * built against are acceptance tests, not an exhaustive survey of Oracle
 * templating, so unusual wordings are expected to go unclassified.
 *
 * Known taxonomy gaps: theft (Act of Treason) and hand disruption
 * (Thoughtseize) have no role, so those decks show low interaction counts.
 *
 * Known limitation: roles are card-level with no record of which FACE earned
 * them. Ramp reads the front face only, so an MDFC land back
 * (Malakir Rebirth // Malakir Mire) contributes nothing to ramp. Correct for a
 * "what did I cast" reading; it would undercount for mana-base math.
 */

// ---------------------------------------------------------------------------
// Text normalization
// ---------------------------------------------------------------------------

/**
 * Drop parenthetical reminder text.
 *
 * Load-bearing: Dryad Arbor's ONLY mana ability is parenthetical, and Opt's
 * scry reminder repeats "look at the top card".
 */
function stripReminder(text: string): string {
  return text.replace(/\([^()]*\)/g, ' ');
}

/**
 * Blank out quoted spans, which is how Oracle text expresses a GRANTED ability.
 *
 * This single step resolves three separate traps: Malakir Rebirth and Feign
 * Death hide "return it to the battlefield" inside a granted death trigger, and
 * Imprisoned in the Moon hides "{T}: Add {C}" inside a quote.
 */
function dequote(text: string): string {
  return text.replace(/"[^"]*"/g, '   ');
}

/**
 * The front face of an oracle text blob.
 *
 * Deliberately NOT cardFacts.frontFace(): that splits a TYPE LINE on a bare
 * '//', while the mapper joins oracle faces with the literal '\n//\n'.
 */
function frontOracle(text: string): string {
  return text.split('\n//\n')[0] ?? '';
}

/** Split into sentence / line / modal-bullet units. */
function clauses(text: string): string[] {
  return text
    .split(/(?<=[.!])\s+|\n|•/)
    .map((c) => c.trim())
    .filter(Boolean);
}

/** The text views a rule may read, computed once per card. */
interface CardText {
  /** Front face, reminder-stripped and dequoted. The default. */
  front: string;
  /** All faces, reminder-stripped and dequoted. */
  all: string;
  /** Front face, reminder-stripped but quotes INTACT. */
  frontQuoted: string;
  /** Clauses of `front`. */
  frontClauses: string[];
  /** Lines of `front` (before clause splitting). */
  frontLines: string[];
}

function buildCardText(card: ResolvedCard): CardText {
  const reminderless = stripReminder(card.oracleText);
  const frontRaw = frontOracle(reminderless);
  const front = dequote(frontRaw);
  return {
    front,
    all: dequote(reminderless),
    frontQuoted: frontRaw,
    frontClauses: clauses(front),
    frontLines: front.split('\n').map((l) => l.trim()).filter(Boolean),
  };
}

// ---------------------------------------------------------------------------
// Shared patterns
// ---------------------------------------------------------------------------

/** Mana actually produced, not merely the word "mana". */
const MANA_PRODUCED =
  String.raw`(?:\{[WUBRGCSX]|\bone mana\b|\btwo mana\b|\bthree mana\b|\bX mana\b|\bmana of any\b|\bmana in any\b)`;

/**
 * An activated/triggered ability line that adds mana.
 *
 * `[^\n"]` is load-bearing twice: it confines the match to a single line, and
 * it cannot cross a quote (keeping Imprisoned in the Moon out of ramp).
 */
const MANA_ABILITY = new RegExp(
  String.raw`(^|\n)[^\n"]*?:[^\n"]*?\badd\b[^\n"]*?` + MANA_PRODUCED,
  'i',
);

/** A line carrying an activation cost, e.g. "{T}:" or "{1}{G}, {T}:". */
const HAS_ACTIVATION_COST = /^[^:\n]{0,60}\{[^}\n]+\}[^:\n]{0,40}:/;

/** Library-search clauses, capturing only what is being searched FOR. */
const SEARCH_TARGET =
  /\bsearch(?:es)?\s+(?:your|their|its owner's|a|an)?\s*(?:library|libraries)\s+for\s+([^.;]*)/gi;

/**
 * Does a search-target phrase describe land cards?
 *
 * Includes basic-land TYPE names, or fetchlands ("a Mountain or Forest card")
 * would classify as tutors rather than ramp.
 */
const LANDISH =
  /\bland\b|\blands\b|\bPlains\b|\bIsland\b|\bSwamp\b|\bMountain\b|\bForest\b|\bWastes\b|\bGate\b|\bDesert\b|\bCave\b|\bLocus\b/i;

/**
 * A search performed by someone else, which is not our ramp.
 *
 * Verified against the live text of Path to Exile: "Its controller MAY search
 * their library for a basic land card" — the modal verb sits between the
 * subject and "search", so the gap must be permissive.
 */
const OPPONENT_SEARCH =
  /\b(?:its|their)\s+controller\b|\beach\s+opponent\b|\btarget\s+player\b|\bthat\s+player\b|\beach\s+player\b/i;

/** References a zone other than the battlefield. */
const OFF_BATTLEFIELD =
  /\bfrom\s+(?:a|your|their|an opponent's|each opponent's|target player's)?\s*(?:graveyard|library|hand|exile)\b|\bin\s+(?:a|your|their|an opponent's)?\s*graveyard\b/i;

const REPEATABLE = /\b(?:whenever|at the beginning of)\b/i;

const WORD_NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

/** The largest number of cards a single clause draws. X counts as 2. */
function maxDraw(text: string): number {
  let max = 0;
  const re = /\bdraws?\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|X|\d+)\s+(?:additional\s+)?cards?\b/gi;
  for (const m of text.matchAll(re)) {
    const token = (m[1] ?? '').toLowerCase();
    const n = token === 'x' ? 2 : (WORD_NUMBERS[token] ?? Number.parseInt(token, 10));
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  return max;
}

/** Draw granted to someone else, which is not our card advantage. */
const OTHERS_DRAW =
  /\b(?:an?\s+opponent|each\s+opponent|another\s+player|that\s+player|each\s+player)\s+draws?\b/i;

// ---------------------------------------------------------------------------
// Oracle-id exceptions
// ---------------------------------------------------------------------------

/**
 * Cards whose role is real but absent from their oracle text.
 *
 * Kept deliberately tiny. This is NOT a place to compensate for weak rules — if
 * this list grows, the rules need work instead. Mirrors the ELIGIBLE_BY_RULING
 * pattern in commander.ts.
 *
 * Containment Priest reads "If a nontoken creature would enter and it wasn't
 * cast, exile it instead" — verified against the live API to contain no
 * "graveyard" at all — yet it exists to stop reanimation. No text rule reaches it.
 */
const ROLE_EXCEPTIONS: { oracleId: string; name: string; roles: CardRole[] }[] = [
  {
    oracleId: '8a76a9b9-3127-45fe-b20f-a8f643276281',
    name: 'containment priest',
    roles: ['graveyard_hate'],
  },
];

function exceptionRoles(card: ResolvedCard): CardRole[] {
  const name = card.name.trim().toLowerCase();
  const hit = ROLE_EXCEPTIONS.find(
    (e) => e.oracleId === card.oracleId || e.name === name,
  );
  return hit ? hit.roles : [];
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

interface RoleRule {
  id: string;
  role: CardRole;
  matches(card: ResolvedCard, text: CardText): boolean;
}

/**
 * Whether a given search match belongs to someone else.
 *
 * SEARCH_TARGET begins matching at the word "search", so the subject performing
 * it ("Its controller may ...") sits BEFORE the match. The preceding sentence
 * fragment is what must be inspected — testing the match itself always fails.
 */
function isOpponentSearch(text: string, matchIndex: number): boolean {
  const preceding = text.slice(0, matchIndex);
  // Only the current sentence matters, not the whole card.
  const sentenceStart = Math.max(
    preceding.lastIndexOf('. '),
    preceding.lastIndexOf('\n'),
    preceding.lastIndexOf('•'),
  );
  const subject = preceding.slice(sentenceStart + 1);
  return OPPONENT_SEARCH.test(subject);
}

/** True when any library-search clause searches for land cards. */
function searchesForLand(text: string): boolean {
  for (const m of text.matchAll(SEARCH_TARGET)) {
    if (isOpponentSearch(text, m.index ?? 0)) continue;
    if (LANDISH.test(m[1] ?? '')) return true;
  }
  return false;
}

/** True when any library-search clause searches for something other than land. */
function searchesForNonLand(text: string): boolean {
  for (const m of text.matchAll(SEARCH_TARGET)) {
    if (isOpponentSearch(text, m.index ?? 0)) continue;
    if (!LANDISH.test(m[1] ?? '')) return true;
  }
  return false;
}

/** Grants a death trigger to a creature already on the battlefield. */
function isDeathTriggerSave(text: CardText): boolean {
  return /\bgains?\s+"?when this creature dies, return it to the battlefield/i.test(
    text.frontQuoted,
  );
}

const ROLE_RULES: RoleRule[] = [
  // --- ramp ---------------------------------------------------------------
  {
    // Mana rocks and mana dorks. The isLand guard is what excludes Bojuka Bog,
    // Command Tower, and Dryad Arbor (whose ability is also reminder text).
    id: 'mana-ability',
    role: 'ramp',
    matches: (card, text) => !isLand(card) && MANA_ABILITY.test(text.front),
  },
  {
    // One-shot mana (Dark Ritual). Evaluated per LINE, skipping lines with an
    // activation cost: clause-splitting would sever "{T}:" from a following
    // "Add one mana" sentence, which is exactly Deathrite Shaman's shape.
    id: 'mana-ritual',
    role: 'ramp',
    matches: (card, text) =>
      !isLand(card) &&
      text.frontLines.some(
        (line) =>
          !HAS_ACTIVATION_COST.test(line) &&
          new RegExp(String.raw`^add\b[^.]*?` + MANA_PRODUCED, 'i').test(line),
      ),
  },
  {
    id: 'treasure-generation',
    role: 'ramp',
    matches: (_card, text) =>
      /\bcreate\b[^.]{0,60}?\b(?:Treasure|Gold|Powerstone)\b[^.]{0,20}?\btokens?\b/i.test(
        text.front,
      ),
  },
  {
    // Land development: Cultivate, Kodama's Reach, Land Tax, Expedition Map.
    // Keying on the search TARGET (not whole text) matters: Land Tax says
    // "controls more lands than you" elsewhere.
    //
    // The isLand guard excludes fetchlands: a land that fetches a land IS the
    // mana base rather than acceleration on top of it, consistent with
    // ordinary lands not counting as ramp.
    id: 'land-search',
    role: 'ramp',
    matches: (card, text) => !isLand(card) && searchesForLand(text.front),
  },

  // --- tutor --------------------------------------------------------------
  {
    // Any library search that is not land development.
    id: 'library-search',
    role: 'tutor',
    matches: (_card, text) => searchesForNonLand(text.front),
  },

  // --- card_advantage -----------------------------------------------------
  {
    // Plural draw with no offsetting discard. Excludes Ponder/Opt/Preordain
    // (single "Draw a card") and Faithless Looting (draw two, discard two).
    id: 'multi-draw',
    role: 'card_advantage',
    matches: (_card, text) =>
      maxDraw(text.front) >= 2 &&
      !/\bdiscards?\b/i.test(text.front) &&
      !OTHERS_DRAW.test(text.front),
  },
  {
    // Repeatable draw engines: Rhystic Study, Beast Whisperer, Skullclamp.
    id: 'repeatable-draw',
    role: 'card_advantage',
    matches: (_card, text) =>
      REPEATABLE.test(text.front) &&
      maxDraw(text.front) >= 1 &&
      text.frontClauses.some(
        (c) => maxDraw(c) >= 1 && !OTHERS_DRAW.test(c),
      ),
  },
  {
    id: 'impulse-draw',
    role: 'card_advantage',
    matches: (_card, text) =>
      /\byou may play (?:those|that|them)\b[^.]*\bcards?\b|\byou may play those cards\b/i.test(
        text.front,
      ),
  },

  // --- card_selection -----------------------------------------------------
  {
    // Filtering, scrying, surveilling, looting, rearranging. Tutors excluded.
    //
    // Lands are excluded: Path of Ancestry's "scry 1" is a conditional rider on
    // its mana ability, not a card-selection effect, and a land filling this
    // role would overstate the deck's real selection density.
    id: 'library-filter',
    role: 'card_selection',
    matches: (card, text) => {
      if (isLand(card)) return false;
      if (searchesForLand(text.front) || searchesForNonLand(text.front)) return false;
      const selection =
        /\bscry\s+\d+\b|\bsurveil\s+\d+\b|\blook at the top\b|\bput\s+\w+\s+cards?\s+from your hand on top of your library\b/i;
      if (selection.test(text.front)) return true;
      // Draw-then-discard looting (Faithless Looting).
      return maxDraw(text.front) >= 1 && /\bdiscards?\b/i.test(text.front);
    },
  },

  // --- interaction --------------------------------------------------------
  {
    id: 'targeted-removal',
    role: 'interaction',
    matches: (_card, text) =>
      text.frontClauses.some((c) => {
        // Exiling from a graveyard is graveyard hate, not interaction.
        if (OFF_BATTLEFIELD.test(c)) return false;
        // Nor is exiling a graveyard itself ("exile target player's graveyard").
        if (/\bgraveyards?\b/i.test(c)) return false;
        // "Exile target creature you control, then return it" is a blink.
        if (/\byou control\b/i.test(c) && /\breturn\b/i.test(c)) return false;
        return (
          /\b(?:destroy|exile)\s+(?:\w+\s+)?target\b/i.test(c) ||
          /\breturn\s+target\b[^.]*\bto\s+(?:its|their)\s+owner'?s?\s+hand\b/i.test(c) ||
          /\bcounter\s+target\b/i.test(c) ||
          /\bfights?\s+target\b/i.test(c)
        );
      }),
  },
  {
    // Neutralizing auras: Imprisoned in the Moon, Darksteel Mutation,
    // Song of the Dryads.
    id: 'neutralizing-aura',
    role: 'interaction',
    matches: (_card, text) =>
      /\benchanted\s+(?:permanent|creature|land)\b[^.]*?\bloses all\b/i.test(text.front) ||
      /\benchanted\s+permanent\s+is\s+a\s+colorless\b/i.test(text.front),
  },

  // --- board_wipe ---------------------------------------------------------
  {
    // Overload turns "target" into "each". Per the agreed decision, Overload
    // implies board_wipe while the base targeted mode still earns interaction.
    id: 'overload',
    role: 'board_wipe',
    matches: (card) => card.keywords.some((k) => /^overload$/i.test(k)),
  },
  {
    // Mass destruction/exile. Requires the literal word "all" near the verb and
    // must not span a clause or modal bullet, so Farewell and Austere Command
    // match within a single bullet. 'graveyard' is deliberately NOT a noun here:
    // Rest in Peace's "exile all graveyards" is graveyard hate, not a wipe.
    id: 'mass-removal',
    role: 'board_wipe',
    matches: (_card, text) =>
      text.frontClauses.some(
        (c) =>
          !/\btarget\b/i.test(c) &&
          /\b(?:destroy|exile|sacrifices?)\b[^.\n•]{0,40}?\ball\s+(?:other\s+)?(?:artifacts?|creatures?|enchantments?|lands?|permanents?|planeswalkers?|nonland permanents?)\b/i.test(
            c,
          ),
      ),
  },
  {
    id: 'mass-damage',
    role: 'board_wipe',
    matches: (_card, text) =>
      /\bdeals\s+\d+\s+damage\s+to\s+each\s+(?:creature|other creature)\b/i.test(text.front),
  },
  {
    id: 'mass-shrink',
    role: 'board_wipe',
    matches: (_card, text) => /\ball creatures get\s+-/i.test(text.front),
  },
  {
    id: 'mass-sacrifice',
    role: 'board_wipe',
    matches: (_card, text) =>
      /\beach player sacrifices\b/i.test(text.front) && !/\btarget\b/i.test(text.front),
  },
  {
    // Ezuri's Predation: mass token-fight. Narrow by design.
    id: 'mass-fight',
    role: 'board_wipe',
    matches: (_card, text) =>
      /\bfor each creature your opponents control\b/i.test(text.front) &&
      /\bfights?\b/i.test(text.front),
  },

  // --- protection ---------------------------------------------------------
  {
    // Grants a protective quality to YOUR stuff. The 'enchanted' veto keeps
    // Darksteel Mutation (which grants indestructible to the victim) out.
    id: 'grant-protective-quality',
    role: 'protection',
    matches: (_card, text) =>
      text.frontClauses.some((c) => {
        if (/\benchanted\b/i.test(c)) return false;
        const grants =
          /\b(?:gain|gains|have|has)\b[^.]*\b(?:hexproof|indestructible|shroud|protection from)\b/i.test(
            c,
          ) || /\bphase(?:s)? out\b/i.test(c);
        if (!grants) return false;
        return /\byou control\b|\byour\b|\bequipped creature\b|\bthis creature\b|\byou gain\b|\byou\b/i.test(
          c,
        );
      }),
  },
  {
    id: 'uncounterable',
    role: 'protection',
    matches: (_card, text) => /\bcan't be countered\b/i.test(text.front),
  },
  {
    // Counterspells are protective per the agreed spec. The negative lookahead
    // keeps Stifle (counters an ABILITY) interaction-only.
    id: 'counter-spell',
    role: 'protection',
    matches: (_card, text) =>
      /\bcounter target\b(?:(?!\bability\b)[^.])*?\bspell\b/i.test(text.front),
  },
  {
    id: 'redirect-targets',
    role: 'protection',
    matches: (_card, text) => /\bchoose new targets\b/i.test(text.front),
  },
  {
    id: 'blink-own',
    role: 'protection',
    matches: (_card, text) =>
      /\bexile\s+target\s+(?:creature|permanent)\s+you\s+control\b[^.]*?\breturn\b/i.test(
        text.front,
      ),
  },
  {
    // Malakir Rebirth, Feign Death: pre-emptive recovery granted BEFORE death.
    // Reads quoted text, since the grant is what identifies it.
    id: 'death-trigger-save',
    role: 'protection',
    matches: (_card, text) => isDeathTriggerSave(text),
  },

  // --- recursion ----------------------------------------------------------
  {
    // Retrieval of an ALREADY-graveyarded card. Gated on the death-trigger
    // shape so Malakir Rebirth and Feign Death stay protection-only.
    id: 'graveyard-retrieval',
    role: 'recursion',
    matches: (_card, text) => {
      if (isDeathTriggerSave(text)) return false;
      return (
        /\breturn\s+(?:target|enchanted|all)\b[^.]*\b(?:from|in)\s+(?:your|a|their)\s+graveyard\b/i.test(
          text.all,
        ) ||
        /\breturn\s+(?:target|enchanted)\b[^.]*\bcard\b[^.]*\bto the battlefield\b/i.test(
          text.all,
        ) ||
        /\bput\s+target\s+\w+\s+card\s+from\s+a\s+graveyard\s+onto the battlefield\b/i.test(
          text.all,
        ) ||
        /\bcards?\s+in\s+(?:a|your)\s+graveyard\s+(?:gains?|has|have)\s+flashback\b/i.test(
          text.all,
        ) ||
        /\b(?:cast|play)\b[^.]*\bfrom your graveyard\b/i.test(text.all) ||
        /\bin your graveyard\s+(?:has|have)\s+escape\b/i.test(text.all) ||
        /\bexiles? all creature cards from their graveyard\b/i.test(text.all)
      );
    },
  },
  {
    // Cards that recur themselves via a keyword.
    id: 'self-recursive-keyword',
    role: 'recursion',
    matches: (card) =>
      card.keywords.some((k) =>
        /^(?:flashback|escape|aftermath|disturb|embalm|eternalize|encore|jump-start|recover|unearth)$/i.test(
          k,
        ),
      ),
  },

  // --- graveyard_hate -----------------------------------------------------
  {
    id: 'exile-graveyard',
    role: 'graveyard_hate',
    matches: (_card, text) =>
      text.frontClauses.some((c) => {
        // Exiling from YOUR OWN graveyard as a cost is not hate
        // (Yawgmoth's Will, Underworld Breach).
        const selfOnly =
          /\bfrom your graveyard\b|\bother cards from your graveyard\b/i.test(c) &&
          !/\ball graveyards\b|\beach opponent\b|\btarget player\b/i.test(c);
        if (selfOnly) return false;
        // Living Death exiles then returns; it is a wipe + recursion, not hate.
        if (/\bexiled this way\b/i.test(text.front)) return false;
        return (
          /\bexile\s+(?:target player's|all|each opponent's)\s+graveyards?\b/i.test(c) ||
          /\bexile\s+target\s+[^.]*\bcard\s+(?:from|in)\s+a\s+graveyard\b/i.test(c)
        );
      }),
  },
  {
    // Replacement effects: Leyline of the Void, Rest in Peace, Dauthi Voidwalker.
    // Must not fire on YOUR OWN graveyard: Yawgmoth's Will exiles cards headed
    // to your graveyard as a cost of its own engine, which is not hate.
    id: 'graveyard-replacement',
    role: 'graveyard_hate',
    matches: (_card, text) =>
      text.frontClauses.some(
        (c) =>
          /\bwould be put into\b[^.]*\bgraveyard\b[^.]*\bexile\b/i.test(c) &&
          !/\byour graveyard\b/i.test(c),
      ),
  },
  {
    // Static lockouts: Grafdigger's Cage, Ground Seal.
    id: 'graveyard-lockout',
    role: 'graveyard_hate',
    matches: (_card, text) =>
      /\bgraveyards?\b/i.test(text.front) &&
      /\bcan't\s+(?:enter|be cast|be the targets?|cast)\b/i.test(text.front),
  },
  {
    id: 'graveyard-name-extraction',
    role: 'graveyard_hate',
    matches: (_card, text) =>
      /\bsearch\b[^.]*\bgraveyard\b[^.]*\bexile them\b/i.test(text.front),
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify one card. Every positive match names the rule that fired, so any
 * classification can be audited back to its cause.
 */
export function classifyCardRoles(card: ResolvedCard): CardRoleAnalysis {
  const text = buildCardText(card);

  const assignments: CardRoleAssignment[] = ROLE_RULES.filter((rule) =>
    rule.matches(card, text),
  ).map((rule) => ({ role: rule.role, ruleId: rule.id }));

  for (const role of exceptionRoles(card)) {
    if (!assignments.some((a) => a.role === role)) {
      assignments.push({ role, ruleId: 'known-role-exception' });
    }
  }

  return { cardId: card.scryfallId, assignments };
}

function emptyRoleRecord<T>(make: () => T): Record<CardRole, T> {
  return Object.fromEntries(CARD_ROLES.map((r) => [r, make()])) as Record<CardRole, T>;
}

/**
 * Aggregate roles across a deck.
 *
 * Counts are quantity-weighted; `cardsByRole` lists distinct names in encounter
 * order (commanders first). Commanders are classified because they are part of
 * the 100. Totals are NOT expected to sum to the deck size.
 */
export function analyzeDeckRoles(composition: DeckComposition): DeckRoleProfile {
  const counts = emptyRoleRecord<number>(() => 0);
  const cardsByRole = emptyRoleRecord<string[]>(() => []);

  const entries: { card: ResolvedCard; quantity: number }[] = [
    ...composition.commanders.map((card) => ({ card, quantity: 1 })),
    ...composition.mainboard,
  ];

  for (const { card, quantity } of entries) {
    const { assignments } = classifyCardRoles(card);
    // A card matching two rules for the same role counts once for that role.
    const roles = new Set(assignments.map((a) => a.role));
    for (const role of roles) {
      counts[role] += quantity;
      if (!cardsByRole[role].includes(card.name)) cardsByRole[role].push(card.name);
    }
  }

  return { counts, cardsByRole };
}
