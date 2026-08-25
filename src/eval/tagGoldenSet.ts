import type { CardTag } from '@/domain/types';

/**
 * DEVELOPER TOOLING ONLY (see bulkCards.ts).
 *
 * Manually labeled strategy-tag evaluation set. Every card exists in
 * tests/fixtures/roleCards.json with oracle text captured from the live
 * Scryfall API, so labels are asserted against genuine wording.
 *
 * PARTIAL ASSERTIONS, as with the role golden set: `expect` tags must be
 * present, `exclude` tags must be absent, and any other tag is unspecified and
 * never fails a case. Tags are multi-valued and the taxonomy is broad, so this
 * keeps cases stable.
 */
export interface TagGoldenCase {
  name: string;
  expect: CardTag[];
  exclude: CardTag[];
  note?: string;
}

/** Every counter tag in the taxonomy, for "no counter tags at all" assertions. */
const ALL_COUNTER_TAGS: CardTag[] = [
  'counter_generation',
  'counter_payoff',
  'counter_doubling',
  'proliferate',
  'plus_one_counters',
];
const ALL_ARTIFACT_TAGS: CardTag[] = [
  'artifact_generation',
  'artifact_payoff',
  'artifact_cost_reduction',
  'artifact_sacrifice',
];
const ALL_ENCHANTMENT_TAGS: CardTag[] = [
  'enchantment_generation',
  'enchantment_payoff',
  'enchantment_cost_reduction',
  'aura',
];
const ALL_SPELL_TAGS: CardTag[] = [
  'spell_payoff',
  'spell_copy',
  'spell_cost_reduction',
  'spell_recursion',
];
const ALL_LAND_TAGS: CardTag[] = ['landfall', 'land_payoff', 'land_recursion'];
const ALL_COMBAT_TAGS: CardTag[] = [
  'attack_payoff',
  'combat_damage_payoff',
  'extra_combat',
  'voltron',
  'go_wide_payoff',
];
const ALL_PLANESWALKER_TAGS: CardTag[] = [
  'planeswalker_payoff',
  'planeswalker_generation',
  'planeswalker_doubling',
];

export const TAG_GOLDEN_SET: TagGoldenCase[] = [
  // === Counters ==========================================================
  {
    name: 'Hardened Scales',
    expect: ['counter_doubling'],
    exclude: ['plus_one_counters'],
    note: 'Replacement effect only causes counters; it never reads or moves them.',
  },
  {
    name: 'Evolution Sage',
    expect: ['proliferate', 'planeswalker_payoff'],
    exclude: [],
    note: 'Proliferate adds loyalty counters, which is why it is a planeswalker payoff.',
  },
  {
    name: 'Walking Ballista',
    expect: ['counter_generation', 'counter_payoff', 'plus_one_counters'],
    exclude: [],
    note: 'Enters with X counters, adds more, and REMOVES them as a resource.',
  },
  {
    name: 'Forgotten Ancient',
    expect: ['counter_generation', 'plus_one_counters'],
    exclude: [],
    note: 'Moves counters between creatures, so counters are manipulable state.',
  },
  {
    name: 'Hangarback Walker',
    expect: ['counter_generation', 'counter_payoff', 'plus_one_counters'],
    exclude: [],
    note: 'Reads "for each +1/+1 counter" when it dies.',
  },
  {
    name: 'Fathom Mage',
    expect: ['counter_payoff'],
    exclude: ['plus_one_counters'],
    note: 'REACTS to counters being placed; never reads or consumes them.',
  },
  {
    name: 'Kami of Whispered Hopes',
    expect: ['counter_payoff', 'counter_doubling'],
    exclude: ['plus_one_counters'],
    note: 'Doubles counters and spends its counter-derived power, but never moves or removes counters.',
  },
  {
    name: 'Solemnity',
    expect: [],
    exclude: ALL_COUNTER_TAGS,
    note: 'OPPOSES counters ("Players can\'t get counters"); mentioning is not participating.',
  },
  {
    name: 'Vampire Hexmage',
    expect: [],
    exclude: ALL_COUNTER_TAGS,
    note: 'Removes all counters as removal; it attacks counter strategies.',
  },

  // === Tokens ============================================================
  {
    name: 'Smothering Tithe',
    expect: ['token_generation'],
    exclude: ALL_ENCHANTMENT_TAGS,
    note: 'An Enchantment that makes Treasure. Card type alone implies nothing.',
  },
  { name: 'Skullclamp', expect: ['token_payoff'], exclude: [], note: 'Contextual: tokens are its fodder (documented exception).' },
  { name: "Ashnod's Altar", expect: ['token_payoff'], exclude: [], note: 'Contextual token payoff (documented exception).' },
  { name: 'Impact Tremors', expect: ['token_payoff'], exclude: [], note: 'ETB-swarm payoff.' },
  { name: 'Intangible Virtue', expect: ['token_payoff'], exclude: [], note: 'Explicitly buffs creature tokens.' },
  {
    name: 'Viscera Seer',
    expect: ['sacrifice_outlet'],
    exclude: ['token_payoff'],
    note: 'Can eat tokens but has no token synergy: compatibility is not a payoff.',
  },
  {
    name: 'Pongify',
    expect: [],
    exclude: ['token_generation'],
    note: 'The token goes to the removed creature\'s controller, not you.',
  },
  {
    name: 'Beast Within',
    expect: [],
    exclude: ['token_generation'],
    note: 'Same opponent-token template as Pongify.',
  },
  { name: 'Bitterblossom', expect: ['token_generation'], exclude: [], note: 'Recurring token maker.' },
  { name: 'Parallel Lives', expect: ['token_doubling'], exclude: [], note: 'Token replacement doubling.' },
  { name: 'Anointed Procession', expect: ['token_doubling'], exclude: [], note: 'Same template as Parallel Lives.' },

  // === Sacrifice / Death =================================================
  { name: 'Viscera Seer', expect: ['sacrifice_outlet'], exclude: [], note: 'Free repeatable sacrifice.' },
  { name: 'Blood Artist', expect: ['death_payoff'], exclude: [], note: 'Triggers on any creature dying.' },
  { name: 'Zulaport Cutthroat', expect: ['death_payoff'], exclude: [], note: 'Aristocrats drain.' },
  { name: 'Mayhem Devil', expect: ['sacrifice_payoff'], exclude: [], note: 'Triggers on a sacrifice, not a death.' },
  { name: 'Grave Pact', expect: ['death_payoff'], exclude: [], note: 'Death trigger forcing opponent sacrifices.' },
  { name: 'Reassembling Skeleton', expect: ['sacrifice_fodder'], exclude: [], note: 'Recurs itself to be fed again.' },

  // === Graveyard =========================================================
  { name: 'Entomb', expect: ['graveyard_filling'], exclude: [], note: 'Puts a card straight into the graveyard.' },
  { name: "Stitcher's Supplier", expect: ['self_mill'], exclude: [], note: 'Mills your own library.' },
  { name: 'Wonder', expect: ['graveyard_payoff'], exclude: [], note: 'Works FROM the graveyard.' },
  { name: 'Underworld Breach', expect: ['reanimation'], exclude: [], note: 'Grants escape to graveyard cards.' },
  { name: 'Life from the Loam', expect: ['land_recursion'], exclude: [], note: 'Returns land cards from the graveyard.' },

  // === Artifacts =========================================================
  {
    name: 'Sol Ring',
    expect: [],
    exclude: ALL_ARTIFACT_TAGS,
    note: 'Being an Artifact is not artifact-strategy participation.',
  },
  {
    name: 'Sai, Master Thopterist',
    expect: ['artifact_generation', 'artifact_payoff', 'artifact_sacrifice'],
    exclude: [],
    note: 'Makes artifact tokens, triggers on artifact casts, sacrifices artifacts.',
  },
  {
    name: 'Krark-Clan Ironworks',
    expect: ['artifact_payoff', 'artifact_sacrifice'],
    exclude: [],
    note: 'Consuming artifacts for mana is a payoff for having them.',
  },
  {
    name: 'Myr Battlesphere',
    expect: ['artifact_generation', 'artifact_payoff'],
    exclude: [],
    note: 'Makes artifact tokens and taps them as a resource.',
  },
  {
    name: 'Storm-Kiln Artist',
    expect: ['token_generation', 'spell_payoff', 'artifact_payoff'],
    exclude: [],
    note:
      'Magecraft Treasure maker. Its text says "create a Treasure token" and ' +
      'never the word artifact, so token_generation is the correct generation ' +
      'tag; artifact_generation was a mislabel in the first pass.',
  },

  // === Enchantments ======================================================
  { name: "Sythis, Harvest's Hand", expect: ['enchantment_payoff'], exclude: [], note: 'Triggers on enchantment casts.' },
  { name: 'Starfield Mystic', expect: ['enchantment_cost_reduction'], exclude: [], note: 'Explicit cost reduction.' },
  {
    name: 'Ethereal Armor',
    expect: ['enchantment_payoff', 'aura'],
    exclude: [],
    note: 'An Aura that scales with your enchantment count.',
  },

  // === Spells ============================================================
  { name: 'Young Pyromancer', expect: ['spell_payoff', 'token_generation'], exclude: [], note: 'Token per instant/sorcery.' },
  { name: 'Thousand-Year Storm', expect: ['spell_copy'], exclude: [], note: 'Copies each spell cast.' },
  { name: 'Past in Flames', expect: ['spell_recursion'], exclude: [], note: 'Mass flashback for instants/sorceries.' },
  {
    name: 'Counterspell',
    expect: [],
    exclude: ALL_SPELL_TAGS,
    note: 'Being an instant is not spell-strategy participation.',
  },
  {
    name: 'Ponder',
    expect: [],
    exclude: ALL_SPELL_TAGS,
    note: 'A cantrip does not advance a spells-matter plan by itself.',
  },

  // === Lands =============================================================
  { name: 'Tatyova, Benthic Druid', expect: ['landfall'], exclude: [], note: 'Landfall ability word.' },
  { name: 'Lotus Cobra', expect: ['landfall'], exclude: [], note: 'Landfall mana.' },
  { name: 'Scute Swarm', expect: ['landfall', 'token_generation'], exclude: [], note: 'Landfall tokens.' },
  { name: 'Crucible of Worlds', expect: ['land_recursion'], exclude: [], note: 'Play lands from your graveyard.' },
  { name: 'Ramunap Excavator', expect: ['land_recursion'], exclude: [], note: 'Same template as Crucible.' },
  {
    name: 'The Gitrog Monster',
    expect: ['land_payoff'],
    exclude: [],
    note: 'Extra land drops plus a land-to-graveyard draw trigger.',
  },
  { name: 'Oracle of Mul Daya', expect: ['land_payoff'], exclude: [], note: 'Extra land drops off the library top.' },
  {
    name: 'Cultivate',
    expect: [],
    exclude: ALL_LAND_TAGS,
    note: 'Ordinary land ramp is a Phase 2 role, not a land STRATEGY.',
  },
  {
    name: 'Windswept Heath',
    expect: [],
    exclude: ALL_LAND_TAGS,
    note: 'A fetchland is the mana base, not a lands-matter payoff.',
  },

  // === Combat ============================================================
  { name: 'Etali, Primal Storm', expect: ['attack_payoff'], exclude: [], note: 'Attack trigger.' },
  { name: 'Edric, Spymaster of Trest', expect: ['combat_damage_payoff'], exclude: [], note: 'Combat damage to opponents draws.' },
  { name: 'Aurelia, the Warleader', expect: ['extra_combat', 'attack_payoff'], exclude: [], note: 'Additional combat phase.' },
  {
    name: "Light-Paws, Emperor's Voice",
    expect: ['voltron', 'aura'],
    exclude: [],
    note: 'Tutors Auras attached to itself: stacking value on one creature.',
  },
  { name: 'Craterhoof Behemoth', expect: ['go_wide_payoff'], exclude: [], note: 'Pump scaled by creature count.' },
  {
    name: 'Propaganda',
    expect: [],
    exclude: ALL_COMBAT_TAGS,
    note: 'A defensive tax is not combat-strategy participation.',
  },

  // === Planeswalkers =====================================================
  { name: 'The Chain Veil', expect: ['planeswalker_payoff'], exclude: [], note: 'Extra loyalty activations.' },
  { name: 'Spark Double', expect: ['planeswalker_generation'], exclude: [], note: 'Copies a planeswalker you control.' },
  {
    name: 'Doubling Season',
    expect: ['planeswalker_doubling', 'token_doubling'],
    exclude: [],
    note: 'Doubles both tokens and counters, loyalty included.',
  },
  {
    name: 'Teferi, Hero of Dominaria',
    expect: [],
    exclude: ALL_PLANESWALKER_TAGS,
    note: 'Being a Planeswalker is not planeswalker-strategy participation.',
  },
];

/** Cases labeled with a tag the classifier is known to miss today. */
export const TAG_KNOWN_GAP_CASES: TagGoldenCase[] = TAG_GOLDEN_SET.filter((c) =>
  c.note?.startsWith('KNOWN GAP'),
);
