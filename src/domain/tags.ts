import { buildCardText, type CardText } from './cardText';
import { frontFace } from './cardFacts';
import {
  CARD_TAGS,
  type CardTag,
  type CardTagAnalysis,
  type CardTagAssignment,
  type DeckComposition,
  type DeckTagProfile,
  type ResolvedCard,
} from './types';

/**
 * Deterministic strategy-tag classification. Pure: no I/O, no LLM, no scoring,
 * and no archetype inference — that is a later phase's job.
 *
 * Tags describe which strategies a card ADVANCES. They are deliberately
 * distinct from Phase 2 roles, which describe what a card DOES functionally.
 *
 * Four semantic principles are encoded throughout:
 *  1. A card type alone never implies participation. Sol Ring is an Artifact
 *     with no artifact tag; Teferi is a Planeswalker with no planeswalker tag.
 *  2. Mentioning or interacting with a mechanic is not enough. Solemnity and
 *     Vampire Hexmage both talk about counters while opposing them.
 *  3. A contextual tag needs strong strategic synergy, not mere compatibility
 *     with what a strategy produces. Viscera Seer can eat tokens but is not a
 *     token payoff.
 *  4. Precision over recall. A missed card is preferable to a wrong one,
 *     because deck-level inference would inherit the error invisibly.
 */

// ---------------------------------------------------------------------------
// Shared predicates
// ---------------------------------------------------------------------------

/**
 * Clauses where someone else is the actor, so an effect in them is not ours.
 *
 * Verified live: Pongify and Beast Within read "Its controller creates a 3/3
 * ... token" — the token goes to the opponent, so neither is token generation.
 * Only 44 Commander-legal cards use this template, making it cheap to exclude.
 */
const OTHER_PLAYER_ACTS =
  /\b(?:its|their)\s+controller\s+(?:creates|puts|gains|draws)\b|\beach\s+(?:other\s+)?(?:player|opponent)\s+(?:creates|puts)\b|\btarget\s+(?:player|opponent)\s+creates\b/i;

/** Does this clause describe something YOU get or do? */
function isYours(clause: string): boolean {
  if (OTHER_PLAYER_ACTS.test(clause)) return false;
  return true;
}

/**
 * A card that OPPOSES a mechanic gets no tag for it, even though its text is
 * full of the mechanic's vocabulary.
 */
const ANTI_COUNTER =
  /\bcan't get counters\b|\bcounters can't be put\b|\bremove all counters\b|\bremove (?:a|all|each|any number of) counters? from\b/i;

/** A continuous or triggered benefit, as opposed to a one-shot mention. */
const TRIGGER = /\b(?:whenever|when|at the beginning of)\b/i;

/** Ability-word prefixes appear literally in Oracle text. */
const LANDFALL_WORD = /(?:^|\n)\s*Landfall\s*—/i;
const CONSTELLATION_WORD = /(?:^|\n)\s*Constellation\s*—/i;
const MAGECRAFT_WORD = /(?:^|\n)\s*Magecraft\s*—/i;

/** An activated-ability cost line whose cost sacrifices something. */
const SAC_COST = /(?:^|\n)[^:\n]*\bsacrifice\s+(?:a|an|another|two|three|X|\d+)\b[^:\n]{0,40}:/i;

function hasType(card: ResolvedCard, type: string): boolean {
  return new RegExp(`\\b${type}\\b`, 'i').test(frontFace(card.typeLine));
}

// ---------------------------------------------------------------------------
// Oracle-ID exceptions
// ---------------------------------------------------------------------------

/**
 * Cards whose strategic synergy is real but not derivable from their text.
 *
 * Kept deliberately tiny, per the same discipline as roles.ts. Skullclamp and
 * Ashnod's Altar never say "token", yet both exist in token decks precisely
 * because tokens are the fodder they consume; no general rule can capture that
 * without also swallowing every sacrifice outlet (Viscera Seer), which the
 * specification explicitly excludes.
 */
const TAG_EXCEPTIONS: { oracleId: string; name: string; tags: CardTag[] }[] = [
  {
    oracleId: '65986c1b-8e51-4604-b685-d82fa7d1263a',
    name: 'skullclamp',
    tags: ['token_payoff'],
  },
  {
    oracleId: '4d18bcba-a346-445e-a182-6cc30b7e066d',
    name: "ashnod's altar",
    tags: ['token_payoff'],
  },
];

function exceptionTags(card: ResolvedCard): CardTag[] {
  const name = card.name.trim().toLowerCase();
  const hit = TAG_EXCEPTIONS.find(
    (e) => (e.oracleId && e.oracleId === card.oracleId) || e.name === name,
  );
  return hit ? hit.tags : [];
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

interface TagRule {
  id: string;
  tag: CardTag;
  matches(card: ResolvedCard, text: CardText): boolean;
}

const TAG_RULES: TagRule[] = [
  // === Counters ===========================================================
  {
    // Puts counters on things you control, as an effect you want.
    id: 'places-counters',
    tag: 'counter_generation',
    matches: (_card, text) =>
      !ANTI_COUNTER.test(text.front) &&
      text.frontClauses.some((c) => {
        if (!isYours(c)) return false;
        if (!/\bput\s+(?:a|an|one|two|three|X|that many|another)\b[^.]{0,60}?\bcounters?\b/i.test(c)) {
          return false;
        }
        /*
         * A -1/-1 counter aimed at another creature is REMOVAL, not counter
         * strategy (Instill Infection, Incremental Blight). Only count it when
         * the card also works with +1/+1 counters, which is the -1/-1 synergy
         * shell (e.g. persist/undying interactions).
         */
        if (/-1\/-1 counters?/i.test(c) && !/\+1\/\+1/.test(text.front)) return false;
        return true;
      }),
  },
  {
    // Enters with counters already on it: a generator of its own state.
    id: 'enters-with-counters',
    tag: 'counter_generation',
    matches: (_card, text) =>
      /\benters with\b[^.]{0,40}?\bcounters?\b/i.test(text.front),
  },
  {
    // Benefits BECAUSE counters exist: a trigger keyed to counters, or a
    // continuous effect reading them.
    id: 'counter-trigger-payoff',
    tag: 'counter_payoff',
    matches: (_card, text) =>
      !ANTI_COUNTER.test(text.front) &&
      (/\bwhenever\b[^.]{0,80}?\bcounters?\s+(?:is|are)\s+put\b/i.test(text.front) ||
        /\bfor each\b[^.]{0,40}?\bcounters?\b/i.test(text.front) ||
        /\bnumber of\b[^.]{0,30}?\bcounters?\b/i.test(text.front) ||
        /\bremove\s+(?:a|an|one|two|three|X|all|any number of)\b[^.]{0,40}?\bcounters?\b[^.]{0,40}?:/i.test(
          text.front,
        ) ||
        // Counters feed this creature's power, which the card then spends
        // (Kami of Whispered Hopes taps for mana equal to its power).
        (/\+1\/\+1 counters?\b/i.test(text.front) &&
          /\bwhere X is this creature's power\b/i.test(text.front))),
  },
  {
    // Replacement effect multiplying counters (Hardened Scales, Kami of
    // Whispered Hopes, Doubling Season's counter clause).
    id: 'counter-replacement-doubling',
    tag: 'counter_doubling',
    matches: (_card, text) =>
      /\bif one or more\b[^.]{0,60}?\bcounters? would be put\b[^.]{0,80}?\b(?:that many plus|twice that many)\b/i.test(
        text.front,
      ),
  },
  {
    // Proliferate is a named mechanic; the word alone is the signal.
    id: 'proliferate-effect',
    tag: 'proliferate',
    matches: (_card, text) => /\bproliferate\b/i.test(text.front),
  },
  {
    /*
     * +1/+1 counters treated as a RESOURCE the card reads, consumes, or moves —
     * not merely something it causes to appear. Deliberately narrower than
     * counter_generation/counter_payoff:
     *   yes: Walking Ballista (removes), Hangarback (reads "for each"),
     *        Forgotten Ancient (moves)
     *   no:  Hardened Scales / Kami (replacement), Fathom Mage (reacts),
     *        Cathars' Crusade (only places)
     */
    id: 'plus-one-as-resource',
    tag: 'plus_one_counters',
    matches: (_card, text) =>
      /\bremove\s+(?:a|an|one|two|three|X|all|any number of)\b[^.]{0,40}?\+1\/\+1 counters?\b/i.test(
        text.front,
      ) ||
      /\bmove\s+(?:any number of|a|one|two|three|X)?\s*\+1\/\+1 counters?\b/i.test(text.front) ||
      /\bfor each \+1\/\+1 counter\b/i.test(text.front) ||
      /\bnumber of \+1\/\+1 counters\b/i.test(text.front) ||
      /\benters with X \+1\/\+1 counters\b/i.test(text.front),
  },

  // === Tokens =============================================================
  {
    // Creates tokens for YOU. The isYours guard is what excludes Pongify and
    // Beast Within, whose tokens go to the removed creature's controller.
    id: 'creates-tokens',
    tag: 'token_generation',
    matches: (_card, text) =>
      text.frontClauses.some(
        (c) => isYours(c) && /\bcreates?\b[^.]{0,70}?\btokens?\b/i.test(c),
      ),
  },
  {
    /*
     * Contextual token payoff. Narrow by design: compatibility with tokens is
     * NOT enough (Viscera Seer is only a sacrifice outlet). Recognized shapes
     * are an explicit token reference, or an ETB-swarm trigger that pays off
     * for flooding the board.
     */
    id: 'token-explicit-payoff',
    tag: 'token_payoff',
    matches: (_card, text) =>
      /\bcreature tokens? you control\b/i.test(text.front) ||
      /\btokens? you control\b[^.]{0,40}?\bget\b/i.test(text.front) ||
      /\bfor each\b[^.]{0,30}?\btoken you control\b/i.test(text.front),
  },
  {
    // ETB-swarm payoff: every creature entering gives a benefit, which is what
    // token strategies actually exploit (Impact Tremors, Purphoros).
    id: 'creature-etb-swarm-payoff',
    tag: 'token_payoff',
    matches: (_card, text) =>
      /\bwhenever a(?:nother)? creature you control enters\b/i.test(text.front),
  },
  {
    id: 'token-replacement-doubling',
    tag: 'token_doubling',
    matches: (_card, text) =>
      /\bif an effect would create one or more tokens\b[^.]{0,80}?\btwice that many\b/i.test(
        text.front,
      ),
  },

  // === Sacrifice / Death ==================================================
  {
    // A repeatable way to sacrifice your own permanents: the cost is a sac.
    id: 'sacrifice-cost-outlet',
    tag: 'sacrifice_outlet',
    matches: (_card, text) => SAC_COST.test(text.front),
  },
  {
    // Recurs itself cheaply from the graveyard, so it can be fed repeatedly.
    id: 'self-returning-fodder',
    tag: 'sacrifice_fodder',
    matches: (_card, text) =>
      /\breturn this card from your graveyard to the battlefield\b/i.test(text.front),
  },
  {
    // Triggers on a sacrifice happening.
    id: 'sacrifice-trigger-payoff',
    tag: 'sacrifice_payoff',
    matches: (_card, text) =>
      /\bwhenever\b[^.]{0,60}?\bsacrifices?\b/i.test(text.front),
  },
  {
    // Triggers on creatures dying, the classic aristocrats payoff.
    id: 'death-trigger-payoff',
    tag: 'death_payoff',
    matches: (_card, text) =>
      /\bwhenever\b[^.]{0,80}?\bdies\b/i.test(text.front) ||
      /\bwhenever\b[^.]{0,80}?\bis put into (?:a|your) graveyard from the battlefield\b/i.test(
        text.front,
      ),
  },

  // === Graveyard ==========================================================
  {
    // Deliberately puts cards into a graveyard as the point of the effect.
    id: 'fills-graveyard',
    tag: 'graveyard_filling',
    matches: (_card, text) =>
      /\bsearch your library for a card, put that card into your graveyard\b/i.test(text.front) ||
      /\bput\b[^.]{0,50}?\binto your graveyard\b/i.test(text.front) ||
      /*
       * Discarding only fills the graveyard as a STRATEGY when that is the
       * effect's point — the whole hand, not a cost line. "Discard a card:
       * Regenerate" (Patchwork Gnomes) and loot effects (Keldon Raider) pay a
       * cost; they do not advance a graveyard plan.
       */
      (/\bdiscard\b[^.]{0,30}?\b(?:your hand|all the cards in your hand)\b/i.test(text.front) &&
        !/^[^:\n]*discard[^:\n]*:/im.test(text.front)),
  },
  {
    id: 'self-mill',
    tag: 'self_mill',
    matches: (_card, text) =>
      /\bmill\s+(?:a|one|two|three|four|five|six|seven|X|\d+)\s+cards?\b/i.test(text.front) &&
      !/\btarget (?:opponent|player)\b[^.]{0,20}\bmills?\b/i.test(text.front),
  },
  {
    // Works FROM the graveyard, or rewards having one.
    id: 'graveyard-payoff',
    tag: 'graveyard_payoff',
    matches: (_card, text) =>
      /\bas long as this card is in your graveyard\b/i.test(text.front) ||
      /\bfor each\b[^.]{0,40}?\bin your graveyard\b/i.test(text.front) ||
      /\bcards? in your graveyard\b[^.]{0,40}?\b(?:has|have|gains?)\b/i.test(text.front),
  },
  {
    // Returns creatures/permanents from a graveyard to the battlefield, or
    // enables casting from there.
    id: 'reanimates',
    tag: 'reanimation',
    matches: (_card, text) =>
      /\breturn\b[^.]{0,70}?\bfrom (?:a|your|their) graveyard to the battlefield\b/i.test(
        text.front,
      ) ||
      /\bput\b[^.]{0,60}?\bfrom a graveyard onto the battlefield\b/i.test(text.front) ||
      /\bcards? in your graveyard (?:has|have) escape\b/i.test(text.front) ||
      /\b(?:cast|play)\b[^.]{0,40}?\bfrom your graveyard\b/i.test(text.front),
  },

  // === Artifacts ==========================================================
  {
    id: 'creates-artifacts',
    tag: 'artifact_generation',
    matches: (_card, text) =>
      text.frontClauses.some(
        (c) =>
          isYours(c) &&
          /\bcreates?\b[^.]{0,70}?\bartifact\b[^.]{0,30}?\btokens?\b/i.test(c),
      ),
  },
  {
    // Rewards casting or controlling artifacts. A card merely BEING an
    // artifact never qualifies, which is why Sol Ring has no artifact tag.
    id: 'artifact-payoff',
    tag: 'artifact_payoff',
    matches: (_card, text) =>
      /\bwhenever you cast an artifact spell\b/i.test(text.front) ||
      /\bfor each artifact you control\b/i.test(text.front) ||
      /\bartifacts? you control\b[^.]{0,40}?\b(?:get|gets|have|has)\b/i.test(text.front) ||
      /\bwhenever an artifact\b[^.]{0,40}?\benters\b/i.test(text.front) ||
      // Consuming artifacts for value is a payoff for having them
      // (Krark-Clan Ironworks), as is tapping a squad of them (Myr Battlesphere).
      /\bsacrifice\s+(?:an|another|two|three|X|\d+)?\s*artifacts?\b[^.\n]{0,10}:/i.test(
        text.front,
      ) ||
      /\btap X untapped\b[^.]{0,30}?\byou control\b/i.test(text.front),
  },
  {
    id: 'artifact-cost-reduction',
    tag: 'artifact_cost_reduction',
    matches: (_card, text) =>
      /\bartifact spells you cast cost\b[^.]{0,20}?\bless\b/i.test(text.front),
  },
  {
    id: 'artifact-sacrifice',
    tag: 'artifact_sacrifice',
    matches: (_card, text) =>
      /\bsacrifice\s+(?:an|another|two|three|X|\d+)?\s*artifacts?\b/i.test(text.front),
  },

  // === Enchantments =======================================================
  {
    id: 'creates-enchantments',
    tag: 'enchantment_generation',
    matches: (_card, text) =>
      text.frontClauses.some(
        (c) =>
          isYours(c) &&
          /\bcreates?\b[^.]{0,70}?\benchantment\b[^.]{0,30}?\btokens?\b/i.test(c),
      ),
  },
  {
    // Rewards casting or controlling enchantments. Being an Enchantment is not
    // enough: Smothering Tithe gets no enchantment tag.
    id: 'enchantment-payoff',
    tag: 'enchantment_payoff',
    matches: (_card, text) =>
      /\bwhenever you cast an enchantment spell\b/i.test(text.front) ||
      /\bfor each enchantment you control\b/i.test(text.front) ||
      /\bwhenever an enchantment you control\b/i.test(text.front) ||
      CONSTELLATION_WORD.test(text.front),
  },
  {
    id: 'enchantment-cost-reduction',
    tag: 'enchantment_cost_reduction',
    matches: (_card, text) =>
      /\benchantment spells you cast cost\b[^.]{0,20}?\bless\b/i.test(text.front),
  },
  {
    // An Aura by type, or a card that fetches/moves Auras.
    id: 'aura',
    tag: 'aura',
    matches: (card, text) =>
      hasType(card, 'Aura') ||
      /\bwhenever an Aura you control enters\b/i.test(text.front) ||
      /\bsearch your library for an Aura card\b/i.test(text.front),
  },

  // === Spells =============================================================
  {
    // Rewards casting instants/sorceries.
    id: 'spell-cast-payoff',
    tag: 'spell_payoff',
    matches: (_card, text) =>
      /\bwhenever you cast an instant or sorcery spell\b/i.test(text.front) ||
      /\bwhenever you cast (?:an|your) (?:instant|sorcery|noncreature) spell\b/i.test(text.front) ||
      MAGECRAFT_WORD.test(text.front) ||
      /\bfor each instant and sorcery card\b/i.test(text.front),
  },
  {
    id: 'spell-copy',
    tag: 'spell_copy',
    matches: (_card, text) =>
      /\bcopy (?:it|that spell|target instant or sorcery spell)\b/i.test(text.front) ||
      /\bcopy\b[^.]{0,40}?\bfor each\b[^.]{0,40}?\bspell\b/i.test(text.front),
  },
  {
    id: 'spell-cost-reduction',
    tag: 'spell_cost_reduction',
    matches: (_card, text) =>
      /\b(?:instant|sorcery|instant and sorcery|noncreature)\b[^.]{0,40}?\bspells you cast cost\b[^.]{0,20}?\bless\b/i.test(
        text.front,
      ),
  },
  {
    // Recasting instants/sorceries from the graveyard.
    id: 'spell-recursion',
    tag: 'spell_recursion',
    matches: (_card, text) =>
      /\binstant (?:and|or) sorcery cards? in your graveyard\b/i.test(text.front) ||
      /\btarget instant or sorcery card (?:in|from) your graveyard\b/i.test(text.front) ||
      /\bcast\b[^.]{0,50}?\binstant\b[^.]{0,40}?\bfrom your graveyard\b/i.test(text.front),
  },

  // === Lands ==============================================================
  {
    id: 'landfall',
    tag: 'landfall',
    matches: (_card, text) =>
      LANDFALL_WORD.test(text.front) ||
      /\bwhenever a land you control enters\b/i.test(text.front) ||
      /\bwhenever a land enters the battlefield under your control\b/i.test(text.front),
  },
  {
    // Rewards lands as a resource beyond ordinary land drops: extra drops,
    // counting lands, or lands hitting the graveyard.
    id: 'land-payoff',
    tag: 'land_payoff',
    matches: (_card, text) =>
      /\bplay an additional land\b/i.test(text.front) ||
      /\bfor each land you control\b/i.test(text.front) ||
      /\bwhenever one or more land cards are put into your graveyard\b/i.test(text.front) ||
      /\bplay lands from the top of your library\b/i.test(text.front),
  },
  {
    id: 'land-recursion',
    tag: 'land_recursion',
    matches: (_card, text) =>
      /\bplay lands from your graveyard\b/i.test(text.front) ||
      /\breturn\b[^.]{0,50}?\bland cards? from your graveyard\b/i.test(text.front),
  },

  // === Combat =============================================================
  {
    id: 'attack-trigger-payoff',
    tag: 'attack_payoff',
    matches: (_card, text) =>
      /\bwhenever\b[^.]{0,50}?\battacks\b/i.test(text.front) ||
      /\bwhenever\b[^.]{0,50}?\battacks? for the first time each turn\b/i.test(text.front),
  },
  {
    id: 'combat-damage-payoff',
    tag: 'combat_damage_payoff',
    matches: (_card, text) =>
      /\bdeals combat damage to (?:a player|one of your opponents|an opponent|target player)\b/i.test(
        text.front,
      ),
  },
  {
    id: 'extra-combat',
    tag: 'extra_combat',
    matches: (_card, text) =>
      /\badditional combat phase\b/i.test(text.front) ||
      /\buntap all creatures you control\b[^.]{0,80}?\badditional combat\b/i.test(text.front),
  },
  {
    /*
     * Voltron: stacking value onto ONE creature, usually the commander.
     * Signals are Aura/Equipment tutoring that attaches, or an effect keyed to
     * how much is attached to a single creature.
     */
    id: 'voltron',
    tag: 'voltron',
    matches: (_card, text) =>
      /\bput that card onto the battlefield attached to\b/i.test(text.front) ||
      /\battach\b[^.]{0,40}?\bto\b[^.]{0,30}?\bthis creature\b/i.test(text.front) ||
      /\bfor each (?:Aura|Equipment) attached to\b/i.test(text.front) ||
      /\bequipped creature gets \+\d+\/\+\d+ for each\b/i.test(text.front),
  },
  {
    // Rewards a wide board: a mass buff scaled by creature count, or a
    // team-wide pump.
    id: 'go-wide-payoff',
    tag: 'go_wide_payoff',
    matches: (_card, text) =>
      /\bcreatures you control\b[^.]{0,80}?\bget \+[X\d]+\/\+[X\d]+\b[^.]{0,80}?\bnumber of creatures you control\b/i.test(
        text.front,
      ) ||
      /\bfor each creature you control\b/i.test(text.front) ||
      /\bcreatures you control get \+\d+\/\+\d+ and (?:gain|have)\b/i.test(text.front),
  },

  // === Planeswalkers ======================================================
  {
    // Rewards HAVING planeswalkers. Being one never qualifies, which is why
    // Teferi, Hero of Dominaria gets no planeswalker tag.
    id: 'planeswalker-payoff',
    tag: 'planeswalker_payoff',
    matches: (_card, text) =>
      /\bfor each planeswalker you control\b/i.test(text.front) ||
      /\bloyalty abilit(?:y|ies) of (?:a|each|target) planeswalker\b/i.test(text.front) ||
      /\bactivate (?:one of its |a )?loyalty abilit/i.test(text.front) ||
      /\bplaneswalkers you control\b[^.]{0,40}?\b(?:get|gets|have|has)\b/i.test(text.front) ||
      // Proliferate adds a loyalty counter to every planeswalker you control,
      // which is why proliferate decks and planeswalker decks overlap.
      /\bproliferate\b/i.test(text.front),
  },
  {
    // Makes additional planeswalkers, e.g. by copying one.
    id: 'planeswalker-generation',
    tag: 'planeswalker_generation',
    matches: (_card, text) =>
      /\bcopy of a (?:creature or planeswalker|planeswalker) you control\b/i.test(text.front) ||
      /\bcreates?\b[^.]{0,60}?\bplaneswalker\b[^.]{0,30}?\btokens?\b/i.test(text.front),
  },
  {
    id: 'planeswalker-loyalty-doubling',
    tag: 'planeswalker_doubling',
    matches: (_card, text) =>
      /\bif an effect would put one or more counters on (?:a permanent|a planeswalker)\b[^.]{0,80}?\btwice that many\b/i.test(
        text.front,
      ) ||
      /\bif one or more\b[^.]{0,40}?\bcounters? would be put on a permanent you control\b[^.]{0,60}?\btwice that many\b/i.test(
        text.front,
      ) ||
      /\bloyalty counters?\b[^.]{0,40}?\btwice that many\b/i.test(text.front),
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify one card's strategy tags. Every positive match names the rule that
 * fired, so any classification can be audited back to its cause.
 */
export function classifyCardTags(card: ResolvedCard): CardTagAnalysis {
  const text = buildCardText(card);

  const assignments: CardTagAssignment[] = TAG_RULES.filter((rule) =>
    rule.matches(card, text),
  ).map((rule) => ({ tag: rule.tag, ruleId: rule.id }));

  for (const tag of exceptionTags(card)) {
    if (!assignments.some((a) => a.tag === tag)) {
      assignments.push({ tag, ruleId: 'known-tag-exception' });
    }
  }

  return { cardId: card.scryfallId, assignments };
}

function emptyTagRecord<T>(make: () => T): Record<CardTag, T> {
  return Object.fromEntries(CARD_TAGS.map((t) => [t, make()])) as Record<CardTag, T>;
}

/**
 * Aggregate strategy tags across a deck.
 *
 * Counts are quantity-weighted; `cardsByTag` lists distinct names in encounter
 * order (commanders first). Commanders are classified because they are part of
 * the 100 and usually define the strategy. Totals are NOT expected to sum to
 * the deck size.
 */
export function analyzeDeckTags(composition: DeckComposition): DeckTagProfile {
  const counts = emptyTagRecord<number>(() => 0);
  const cardsByTag = emptyTagRecord<string[]>(() => []);

  const entries: { card: ResolvedCard; quantity: number }[] = [
    ...composition.commanders.map((card) => ({ card, quantity: 1 })),
    ...composition.mainboard,
  ];

  for (const { card, quantity } of entries) {
    const { assignments } = classifyCardTags(card);
    // A card matching two rules for the same tag counts once for that tag.
    const tags = new Set(assignments.map((a) => a.tag));
    for (const tag of tags) {
      counts[tag] += quantity;
      if (!cardsByTag[tag].includes(card.name)) cardsByTag[tag].push(card.name);
    }
  }

  return { counts, cardsByTag };
}
