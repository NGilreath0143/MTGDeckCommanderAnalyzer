import type { GoldenCase } from './evaluate';

/**
 * DEVELOPER TOOLING ONLY (see bulkCards.ts).
 *
 * Manually labeled evaluation set. Every card here exists in
 * tests/fixtures/roleCards.json with oracle text captured from the live
 * Scryfall API, so labels are asserted against genuine wording.
 *
 * PARTIAL ASSERTIONS: `expect` roles must be present, `exclude` roles must be
 * absent, and any other role is unspecified and never fails a case. That keeps
 * cases stable as the (intentionally incomplete) taxonomy grows.
 *
 * Some cases are labeled with roles the classifier currently MISSES. That is
 * deliberate: a known false negative should show up as a recall gap in the
 * report, not be quietly dropped from the dataset. Each is marked
 * "KNOWN GAP" in its note.
 */

/** Section 1: the Phase 2 semantic edge cases the specification pins down. */
const PHASE_2_EDGE_CASES: GoldenCase[] = [
  {
    name: 'Malakir Rebirth // Malakir Mire',
    expect: ['protection'],
    exclude: ['ramp', 'recursion'],
    note: 'MDFC: land back face taps for {B}, front grants a death trigger. Neither may leak.',
  },
  {
    name: 'Feign Death',
    expect: ['protection'],
    exclude: ['recursion'],
    note: 'Pre-emptive save, not retrieval of an already-graveyarded card.',
  },
  {
    name: 'Dryad Arbor',
    expect: [],
    exclude: ['ramp'],
    note: 'Its only mana ability is parenthetical reminder text.',
  },
  {
    name: 'Bojuka Bog',
    expect: ['graveyard_hate'],
    exclude: ['ramp'],
    note: 'A land that taps for mana is not ramp.',
  },
  {
    name: 'Decimate',
    expect: ['interaction'],
    exclude: ['board_wipe'],
    note: 'Four selected targets is removal, not a wipe.',
  },
  {
    name: 'Hex',
    expect: ['interaction'],
    exclude: ['board_wipe'],
    note: 'Six targets is still targeted removal.',
  },
  {
    name: 'Ponder',
    expect: ['card_selection'],
    exclude: ['card_advantage'],
    note: 'Contains "Draw a card" but is a 1-for-1 cantrip.',
  },
  {
    name: 'Opt',
    expect: ['card_selection'],
    exclude: ['card_advantage'],
    note: 'Cantrip; scry reminder text must not double-count.',
  },
  {
    name: 'Preordain',
    expect: ['card_selection'],
    exclude: ['card_advantage'],
    note: 'Cantrip.',
  },
  {
    name: 'Brainstorm',
    expect: ['card_advantage', 'card_selection'],
    exclude: [],
    note: 'Draws three: net draw plus filtering. Multi-role.',
  },
  {
    name: 'Divination',
    expect: ['card_advantage'],
    exclude: [],
    note: 'Plural draw with no downside.',
  },
  {
    name: 'Faithless Looting',
    expect: ['card_selection', 'recursion'],
    exclude: ['card_advantage'],
    note: 'Draw two discard two is parity; Flashback makes it self-recursive.',
  },
  {
    name: 'Wheel of Fortune',
    expect: [],
    exclude: ['card_advantage'],
    note: 'Symmetric mass draw is not our card advantage.',
  },
  {
    name: 'Cultivate',
    expect: ['ramp'],
    exclude: ['tutor'],
    note: 'Land development, not a tutor.',
  },
  {
    name: "Kodama's Reach",
    expect: ['ramp'],
    exclude: ['tutor'],
    note: 'Same template as Cultivate.',
  },
  {
    name: 'Expedition Map',
    expect: ['ramp'],
    exclude: ['tutor'],
    note: 'Searches for a (nonbasic) land card: still land development.',
  },
  {
    name: 'Land Tax',
    expect: ['ramp'],
    exclude: ['tutor'],
    note: '"controls more lands than you" earlier in the text must not confuse the split.',
  },
  {
    name: 'Demonic Tutor',
    expect: ['tutor'],
    exclude: ['card_selection'],
    note: 'Tutors are excluded from card selection by specification.',
  },
  {
    name: 'Imprisoned in the Moon',
    expect: ['interaction'],
    exclude: ['ramp'],
    note: 'Grants "{T}: Add {C}" inside quotes; must not read as a mana ability.',
  },
  {
    name: 'Song of the Dryads',
    expect: ['interaction'],
    exclude: ['ramp'],
    note: 'Makes the victim a Forest; not our ramp.',
  },
  {
    name: 'Darksteel Mutation',
    expect: ['interaction'],
    exclude: ['protection'],
    note: 'Grants indestructible to the victim, not to your board.',
  },
  {
    name: 'Stifle',
    expect: ['interaction'],
    exclude: ['protection'],
    note: 'Counters an ability, not a spell.',
  },
  {
    name: 'Counterspell',
    expect: ['interaction', 'protection'],
    exclude: [],
    note: 'Specification: counterspells are protective.',
  },
  {
    name: 'Cyclonic Rift',
    expect: ['interaction', 'board_wipe'],
    exclude: [],
    note: 'Targeted base mode plus Overload.',
  },
  {
    name: 'Vandalblast',
    expect: ['interaction', 'board_wipe'],
    exclude: [],
    note: 'Same Overload shape as Cyclonic Rift.',
  },
  {
    name: 'Farewell',
    expect: ['board_wipe', 'graveyard_hate'],
    exclude: [],
    note: 'Modal: "Exile all graveyards" is a distinct mode from the wipes.',
  },
  {
    name: 'Living Death',
    expect: ['board_wipe', 'recursion'],
    exclude: ['graveyard_hate'],
    note: 'Exiles graveyards only to return the cards; not hate.',
  },
  {
    name: 'Rest in Peace',
    expect: ['graveyard_hate'],
    exclude: ['board_wipe'],
    note: '"Exile all graveyards" must not read as mass permanent removal.',
  },
  {
    name: "Yawgmoth's Will",
    expect: ['recursion'],
    exclude: ['graveyard_hate'],
    note: 'Exiles from YOUR graveyard as an engine cost.',
  },
  {
    name: 'Underworld Breach',
    expect: ['recursion'],
    exclude: ['graveyard_hate'],
    note: 'Escape grant; the exile is a cost you pay.',
  },
  {
    name: "Tormod's Crypt",
    expect: ['graveyard_hate'],
    exclude: ['interaction'],
    note: 'Targets a graveyard, not a permanent.',
  },
  {
    name: 'Scavenging Ooze',
    expect: ['graveyard_hate'],
    exclude: ['interaction'],
    note: 'Exiling from a graveyard is not removal.',
  },
  {
    name: 'Deathrite Shaman',
    expect: ['graveyard_hate', 'ramp'],
    exclude: [],
    note: 'Agreed dual role: exiles graveyards AND adds mana of any color.',
  },
  {
    name: 'Containment Priest',
    expect: ['graveyard_hate'],
    exclude: [],
    note: 'Oracle text never says "graveyard"; matched by the documented exception list.',
  },
  {
    name: 'Act of Treason',
    expect: [],
    exclude: ['interaction'],
    note: 'Theft is deliberately outside the taxonomy.',
  },
  {
    name: 'Thoughtseize',
    expect: [],
    exclude: ['interaction'],
    note: 'Hand disruption is deliberately outside the taxonomy.',
  },
  {
    name: 'Path of Ancestry',
    expect: [],
    exclude: ['card_selection', 'ramp'],
    note: 'Land whose scry is a rider on its mana ability.',
  },
];

/** Section 2: varied Oracle templating, one group per role. */
const RAMP_CASES: GoldenCase[] = [
  { name: 'Sol Ring', expect: ['ramp'], exclude: [], note: 'Classic mana rock.' },
  { name: 'Mana Crypt', expect: ['ramp'], exclude: [], note: 'Rock with a drawback clause.' },
  { name: 'Grim Monolith', expect: ['ramp'], exclude: [], note: 'Rock that does not untap.' },
  { name: 'Mind Stone', expect: ['ramp'], exclude: [], note: 'Rock that can cash in for a card.' },
  { name: 'Jeweled Lotus', expect: ['ramp'], exclude: [], note: 'Commander-restricted mana.' },
  { name: 'Arcane Signet', expect: ['ramp'], exclude: [], note: 'Any-color-in-identity rock.' },
  { name: 'Talisman of Progress', expect: ['ramp'], exclude: [], note: 'Two mana abilities, one with a cost.' },
  { name: 'Birds of Paradise', expect: ['ramp'], exclude: [], note: 'Mana dork with an evasion keyword.' },
  { name: 'Priest of Titania', expect: ['ramp'], exclude: [], note: 'Scaling mana dork.' },
  { name: 'Dark Ritual', expect: ['ramp'], exclude: [], note: 'Ritual: bare "Add", no activation cost.' },
  { name: 'Seething Song', expect: ['ramp'], exclude: [], note: 'Another ritual template.' },
  { name: 'Dockside Extortionist', expect: ['ramp'], exclude: [], note: 'Treasure via ETB trigger.' },
  { name: 'Smothering Tithe', expect: ['ramp'], exclude: [], note: 'Treasure via opponent trigger.' },
  { name: "Brass's Bounty", expect: ['ramp'], exclude: [], note: 'Bulk Treasure creation.' },
  { name: 'Old Gnawbone', expect: ['ramp'], exclude: [], note: 'Treasure on combat damage.' },
  { name: 'Goldspan Dragon', expect: ['ramp'], exclude: [], note: 'Treasure on attack/target.' },
  { name: 'Skyshroud Claim', expect: ['ramp'], exclude: ['tutor'], note: 'Searches for two Forests by type name.' },
  { name: 'Harrow', expect: ['ramp'], exclude: ['tutor'], note: 'Sacrifice-a-land ramp.' },
  { name: 'Sylvan Scrying', expect: ['ramp'], exclude: ['tutor'], note: 'Searches any land to hand.' },
  { name: 'Crop Rotation', expect: ['ramp'], exclude: ['tutor'], note: 'Land-for-land search.' },
  { name: 'Rampant Growth', expect: ['ramp'], exclude: ['tutor'], note: 'Basic land to battlefield.' },
  { name: 'Burnished Hart', expect: ['ramp'], exclude: ['tutor'], note: 'Repeatable-cost land search.' },
  { name: "Wayfarer's Bauble", expect: ['ramp'], exclude: ['tutor'], note: 'Artifact land search.' },
  { name: 'Knight of the White Orchid', expect: ['ramp'], exclude: ['tutor'], note: 'Catch-up land search.' },
  { name: 'Grim Hireling', expect: ['ramp'], exclude: [], note: 'Treasure from combat triggers.' },
  {
    name: 'Carpet of Flowers',
    expect: ['ramp'],
    exclude: [],
    note: 'Triggered mana production; closed in the 2.5 calibration by the mana-trigger rule.',
  },
];

const CARD_ADVANTAGE_CASES: GoldenCase[] = [
  { name: 'Phyrexian Arena', expect: ['card_advantage'], exclude: [], note: 'Upkeep draw engine.' },
  { name: 'Rhystic Study', expect: ['card_advantage'], exclude: [], note: 'Taxing draw trigger.' },
  { name: 'Mystic Remora', expect: ['card_advantage'], exclude: [], note: 'Cumulative-upkeep draw engine.' },
  { name: 'Esper Sentinel', expect: ['card_advantage'], exclude: [], note: 'First-spell draw tax.' },
  { name: 'Beast Whisperer', expect: ['card_advantage'], exclude: [], note: 'Cast-trigger draw.' },
  { name: 'Guardian Project', expect: ['card_advantage'], exclude: [], note: 'Conditional ETB draw.' },
  { name: 'Archivist of Oghma', expect: ['card_advantage'], exclude: [], note: 'Opponent-search trigger.' },
  { name: 'Ohran Frostfang', expect: ['card_advantage'], exclude: [], note: 'Combat-based draw.' },
  { name: 'Skullclamp', expect: ['card_advantage'], exclude: [], note: 'Dies-trigger draw two.' },
  { name: 'Sylvan Library', expect: ['card_advantage'], exclude: [], note: 'Draw-step engine with a cost.' },
  { name: "Night's Whisper", expect: ['card_advantage'], exclude: [], note: 'Draw two, pay life.' },
  { name: 'Painful Truths', expect: ['card_advantage'], exclude: [], note: 'Draw three, pay life.' },
  { name: 'Read the Bones', expect: ['card_advantage', 'card_selection'], exclude: [], note: 'Scry then draw two.' },
  { name: 'Light Up the Stage', expect: ['card_advantage'], exclude: [], note: 'Impulse draw.' },
  {
    name: 'Deep Analysis',
    expect: ['recursion'],
    exclude: [],
    note:
      'Reads "TARGET PLAYER draws two cards", so the draw is not necessarily ' +
      'yours. Labeled card_advantage in the first pass; corrected after ' +
      'subject-based draw attribution exposed the mislabel. Flashback makes it recursive.',
  },
  {
    name: 'Consecrated Sphinx',
    expect: ['card_advantage'],
    exclude: [],
    note: 'Opponent-triggered but YOU draw; closed by subject-based draw attribution.',
  },
  {
    name: 'Necropotence',
    expect: ['card_advantage'],
    exclude: [],
    note:
      'KNOWN GAP (accepted): never uses the word "draw" — it exiles the top ' +
      'card and puts it into your hand. A general "exile top -> hand" rule ' +
      'matches 61 Commander-legal cards, almost all impulse-play effects ' +
      'already covered by impulse-draw, so adding it would trade one recall ' +
      'gap for many false positives. Left unclassified deliberately.',
  },
];

const CARD_SELECTION_CASES: GoldenCase[] = [
  { name: 'Serum Visions', expect: ['card_selection'], exclude: [], note: 'Draw then scry.' },
  { name: 'Sleight of Hand', expect: ['card_selection'], exclude: [], note: 'Look at top two.' },
  { name: 'Anticipate', expect: ['card_selection'], exclude: [], note: 'Look at top three.' },
  { name: 'Impulse', expect: ['card_selection'], exclude: [], note: 'Look at top four.' },
  { name: 'Dig Through Time', expect: ['card_selection'], exclude: [], note: 'Delve selection.' },
  { name: 'Careful Study', expect: ['card_selection'], exclude: ['card_advantage'], note: 'Draw two discard two.' },
  { name: 'Frantic Search', expect: ['card_selection'], exclude: [], note: 'Draw then discard, untap lands.' },
  { name: "Sensei's Divining Top", expect: ['card_selection'], exclude: [], note: 'Repeatable top rearrange.' },
  { name: 'Bolas\'s Citadel', expect: ['card_selection'], exclude: [], note: 'Top-of-library access.' },
  {
    name: 'Fact or Fiction',
    expect: ['card_selection'],
    exclude: [],
    note: '"Reveal the top five cards"; closed by adding reveal-top to the selection rule.',
  },
];

const TUTOR_CASES: GoldenCase[] = [
  { name: 'Vampiric Tutor', expect: ['tutor'], exclude: [], note: 'Any card to top.' },
  { name: 'Mystical Tutor', expect: ['tutor'], exclude: [], note: 'Instant/sorcery to top.' },
  { name: 'Enlightened Tutor', expect: ['tutor'], exclude: [], note: 'Artifact/enchantment to top.' },
  { name: 'Worldly Tutor', expect: ['tutor'], exclude: [], note: 'Creature to top.' },
  { name: 'Idyllic Tutor', expect: ['tutor'], exclude: [], note: 'Enchantment to hand.' },
  { name: "Eladamri's Call", expect: ['tutor'], exclude: [], note: 'Creature to hand at instant speed.' },
  { name: 'Solve the Equation', expect: ['tutor'], exclude: [], note: 'Instant/sorcery to hand.' },
  { name: "Green Sun's Zenith", expect: ['tutor'], exclude: [], note: 'X-cost creature to battlefield.' },
  { name: 'Chord of Calling', expect: ['tutor'], exclude: [], note: 'Convoke creature to battlefield.' },
  { name: 'Natural Order', expect: ['tutor'], exclude: [], note: 'Sacrifice-cost creature search.' },
  { name: 'Tooth and Nail', expect: ['tutor'], exclude: [], note: 'Entwine double search.' },
  { name: 'Fauna Shaman', expect: ['tutor'], exclude: [], note: 'Repeatable activated search.' },
  { name: 'Survival of the Fittest', expect: ['tutor'], exclude: [], note: 'Enchantment engine search.' },
  { name: 'Birthing Pod', expect: ['tutor'], exclude: [], note: 'Value-based search.' },
  { name: 'Gamble', expect: ['tutor'], exclude: [], note: 'Search with a random discard.' },
];

const INTERACTION_CASES: GoldenCase[] = [
  { name: 'Swords to Plowshares', expect: ['interaction'], exclude: [], note: 'Exile a creature.' },
  { name: 'Generous Gift', expect: ['interaction'], exclude: [], note: 'Destroy any permanent.' },
  { name: 'Beast Within', expect: ['interaction'], exclude: [], note: 'Destroy with a token downside.' },
  { name: "Nature's Claim", expect: ['interaction'], exclude: [], note: 'Destroy artifact/enchantment.' },
  { name: 'Krosan Grip', expect: ['interaction'], exclude: [], note: 'Split second destroy.' },
  { name: 'Pongify', expect: ['interaction'], exclude: [], note: 'Destroy with token replacement.' },
  { name: 'Rapid Hybridization', expect: ['interaction'], exclude: [], note: 'Same template as Pongify.' },
  { name: 'Reality Shift', expect: ['interaction'], exclude: [], note: 'Exile plus manifest.' },
  { name: 'Unsummon', expect: ['interaction'], exclude: [], note: 'Bounce to hand.' },
  { name: 'Swan Song', expect: ['interaction', 'protection'], exclude: [], note: 'Narrow counter.' },
  { name: "An Offer You Can't Refuse", expect: ['interaction', 'protection'], exclude: [], note: 'Counter unless pay.' },
  { name: 'Fierce Guardianship', expect: ['interaction', 'protection'], exclude: [], note: 'Free counter.' },
  { name: 'Flusterstorm', expect: ['interaction', 'protection'], exclude: [], note: 'Storm counter.' },
  { name: 'Stern Scolding', expect: ['interaction', 'protection'], exclude: [], note: 'Creature-only counter.' },
  { name: 'Mana Tithe', expect: ['interaction', 'protection'], exclude: [], note: 'White Force Spike.' },
  { name: "Dovin's Veto", expect: ['interaction', 'protection'], exclude: [], note: 'Counter that cannot be countered.' },
  { name: "Kenrith's Transformation", expect: ['interaction'], exclude: [], note: 'Neutralizing aura.' },
  { name: 'Lignify', expect: ['interaction'], exclude: [], note: 'Neutralizing aura, kindred type line.' },
  { name: 'Ghost Quarter', expect: ['interaction'], exclude: [], note: 'Land destruction from a land.' },
  { name: 'Strip Mine', expect: ['interaction'], exclude: [], note: 'Unconditional land destruction.' },
  { name: 'Field of Ruin', expect: ['interaction'], exclude: [], note: 'Symmetric land destruction.' },
  {
    name: 'Chaos Warp',
    expect: [],
    exclude: [],
    note: 'Unspecified: shuffle-away removal is not currently matched; recorded for review.',
  },
  {
    name: 'Pacifism',
    expect: [],
    exclude: [],
    note: 'Unspecified: pacifying auras do not remove or neutralize by the current rule.',
  },
];

const BOARD_WIPE_CASES: GoldenCase[] = [
  { name: 'Wrath of God', expect: ['board_wipe'], exclude: [], note: 'Destroy all creatures.' },
  { name: 'Damnation', expect: ['board_wipe'], exclude: [], note: 'Black Wrath.' },
  { name: 'Cleansing Nova', expect: ['board_wipe'], exclude: [], note: 'Modal wipe.' },
  { name: 'Fumigate', expect: ['board_wipe'], exclude: [], note: 'Wipe with lifegain rider.' },
  { name: 'Hour of Revelation', expect: ['board_wipe'], exclude: [], note: 'Destroy all non-land permanents.' },
  { name: 'Austere Command', expect: ['board_wipe'], exclude: [], note: 'Modal bullets, two chosen.' },
  { name: 'Languish', expect: ['board_wipe'], exclude: [], note: 'Mass -X/-X.' },
  { name: 'Toxic Deluge', expect: ['board_wipe'], exclude: [], note: 'Mass -X/-X for life.' },
  { name: 'Pyroclasm', expect: ['board_wipe'], exclude: [], note: 'Mass damage.' },
  { name: 'Blasphemous Act', expect: ['board_wipe'], exclude: [], note: 'Mass damage, cost reduction.' },
  { name: 'Fiery Confluence', expect: ['board_wipe'], exclude: [], note: 'Modal mass damage.' },
  { name: 'By Invitation Only', expect: ['board_wipe'], exclude: [], note: 'Mass edict.' },
  { name: "Ezuri's Predation", expect: ['board_wipe'], exclude: [], note: 'Mass token fight.' },
  { name: 'Bane of Progress', expect: ['board_wipe'], exclude: [], note: 'ETB mass destruction.' },
  {
    name: 'Ravnica at War',
    expect: ['board_wipe'],
    exclude: [],
    note: '"Exile all multicolored permanents"; closed by allowing modifiers before the noun.',
  },
  {
    name: 'Culling Ritual',
    expect: ['board_wipe'],
    exclude: [],
    note: '"Destroy each nonland permanent"; closed by accepting each in addition to all.',
  },
  {
    name: "Chandra's Ignition",
    expect: ['board_wipe'],
    exclude: [],
    note: 'Damage dealt by a creature to each other creature; closed by the reordered mass-damage pattern.',
  },
];

const PROTECTION_CASES: GoldenCase[] = [
  { name: 'Heroic Intervention', expect: ['protection'], exclude: [], note: 'Mass hexproof/indestructible.' },
  { name: "Teferi's Protection", expect: ['protection'], exclude: [], note: 'Phasing plus protection.' },
  { name: 'Unbreakable Formation', expect: ['protection'], exclude: [], note: 'Mass indestructible.' },
  { name: 'Rootborn Defenses', expect: ['protection'], exclude: [], note: 'Indestructible plus populate.' },
  { name: 'Make a Stand', expect: ['protection'], exclude: [], note: 'Indestructible with a rider.' },
  { name: 'Clever Concealment', expect: ['protection'], exclude: [], note: 'Convoke mass hexproof.' },
  { name: 'Boros Charm', expect: ['protection'], exclude: [], note: 'Modal indestructible.' },
  { name: "Tamiyo's Safekeeping", expect: ['protection'], exclude: [], note: 'Single-target hexproof.' },
  { name: 'Lightning Greaves', expect: ['protection'], exclude: [], note: 'Equipment granting shroud.' },
  { name: 'Swiftfoot Boots', expect: ['protection'], exclude: [], note: 'Equipment granting hexproof.' },
  { name: 'Mother of Runes', expect: ['protection'], exclude: [], note: 'Repeatable protection-from.' },
  { name: 'Selfless Spirit', expect: ['protection'], exclude: [], note: 'Sacrifice for indestructible.' },
  { name: 'Ephemerate', expect: ['protection'], exclude: [], note: 'Blink your own creature.' },
  { name: 'Cloudshift', expect: ['protection'], exclude: [], note: 'Blink template.' },
  { name: 'Deflecting Swat', expect: ['protection'], exclude: [], note: 'Redirect a spell or ability.' },
  { name: 'Veil of Summer', expect: ['protection'], exclude: [], note: 'Uncounterable plus hexproof-from.' },
  { name: 'Toski, Bearer of Secrets', expect: ['protection'], exclude: [], note: 'Cannot be countered.' },
  {
    name: "Faith's Reward",
    expect: [],
    exclude: [],
    note: 'Mass battlefield return; now classified as recursion (see that section).',
  },
];

const RECURSION_CASES: GoldenCase[] = [
  { name: 'Regrowth', expect: ['recursion'], exclude: [], note: 'Graveyard to hand.' },
  { name: 'Eternal Witness', expect: ['recursion'], exclude: [], note: 'ETB graveyard to hand.' },
  { name: 'Timeless Witness', expect: ['recursion'], exclude: [], note: 'Eternalize plus retrieval.' },
  { name: 'Reanimate', expect: ['recursion'], exclude: [], note: 'Graveyard to battlefield.' },
  { name: 'Animate Dead', expect: ['recursion'], exclude: [], note: 'Aura reanimation.' },
  { name: 'Necromancy', expect: ['recursion'], exclude: [], note: 'Enchantment reanimation.' },
  { name: 'Bond of Revival', expect: ['recursion'], exclude: [], note: 'Reanimation with haste.' },
  { name: 'Persist', expect: ['recursion'], exclude: [], note: 'Reanimation with a counter downside.' },
  { name: 'Sun Titan', expect: ['recursion'], exclude: [], note: 'Repeatable permanent return.' },
  { name: "Sevinne's Reclamation", expect: ['recursion'], exclude: [], note: 'Return plus Flashback.' },
  { name: 'Unearth', expect: ['recursion'], exclude: [], note: 'Cheap reanimation with Cycling.' },
  { name: 'Snapcaster Mage', expect: ['recursion'], exclude: [], note: 'Grants flashback.' },
  { name: 'Past in Flames', expect: ['recursion'], exclude: [], note: 'Mass flashback grant.' },
  { name: "Praetor's Counsel", expect: ['recursion'], exclude: [], note: 'Whole graveyard to hand.' },
  { name: 'Emeria Shepherd', expect: ['recursion'], exclude: [], note: 'Landfall reanimation.' },
  { name: "Uro, Titan of Nature's Wrath", expect: ['recursion'], exclude: [], note: 'Escape keyword.' },
  { name: "Kroxa, Titan of Death's Hunger", expect: ['recursion'], exclude: [], note: 'Escape keyword.' },
  { name: 'Lingering Souls', expect: ['recursion'], exclude: [], note: 'Flashback keyword only.' },
  {
    name: 'Wildest Dreams',
    expect: ['recursion'],
    exclude: [],
    note: '"Return X target cards"; closed by allowing a variable quantity before target.',
  },
  {
    name: 'Noxious Revival',
    expect: ['recursion'],
    exclude: [],
    note: 'Graveyard card to top of library; closed by a dedicated retrieval pattern.',
  },
  {
    name: 'Second Sunrise',
    expect: ['recursion'],
    exclude: [],
    note: 'Mass battlefield return; closed by the mass-return retrieval pattern.',
  },
];

const GRAVEYARD_HATE_CASES: GoldenCase[] = [
  { name: 'Leyline of the Void', expect: ['graveyard_hate'], exclude: [], note: 'Replacement to exile.' },
  { name: 'Dauthi Voidwalker', expect: ['graveyard_hate'], exclude: [], note: 'Replacement with void counters.' },
  { name: "Grafdigger's Cage", expect: ['graveyard_hate'], exclude: [], note: 'Static lockout.' },
  { name: 'Ground Seal', expect: ['graveyard_hate'], exclude: [], note: 'Targeting lockout.' },
  { name: 'Weathered Runestone', expect: ['graveyard_hate'], exclude: [], note: 'Static lockout variant.' },
  { name: 'Silent Gravestone', expect: ['graveyard_hate'], exclude: [], note: 'Lockout with an activated exile.' },
  { name: 'Nihil Spellbomb', expect: ['graveyard_hate'], exclude: [], note: 'Sacrifice to exile a graveyard.' },
  { name: 'Soul-Guide Lantern', expect: ['graveyard_hate'], exclude: [], note: 'Multiple hate modes.' },
  { name: 'Relic of Progenitus', expect: ['graveyard_hate'], exclude: [], note: 'Incremental plus mass exile.' },
  { name: 'Scavenger Grounds', expect: ['graveyard_hate'], exclude: [], note: 'Hate from a land.' },
  { name: 'Surgical Extraction', expect: ['graveyard_hate'], exclude: [], note: 'Name-based extraction.' },
  { name: 'Angel of Finality', expect: ['graveyard_hate'], exclude: [], note: 'ETB graveyard exile.' },
  { name: 'Agent of Erebos', expect: ['graveyard_hate'], exclude: [], note: 'Constellation graveyard exile.' },
  { name: 'Cling to Dust', expect: ['graveyard_hate'], exclude: [], note: 'Escape plus targeted exile.' },
  {
    name: 'Planar Void',
    expect: ['graveyard_hate'],
    exclude: [],
    note: 'Triggered graveyard disruption; closed by the graveyard-trigger rule.',
  },
  {
    name: 'Unlicensed Hearse',
    expect: ['graveyard_hate'],
    exclude: [],
    note: '"Exile up to two target cards from a single graveyard"; closed by allowing a bounded quantity.',
  },
];

/** The full labeled dataset. */
export const GOLDEN_SET: GoldenCase[] = [
  ...PHASE_2_EDGE_CASES,
  ...RAMP_CASES,
  ...CARD_ADVANTAGE_CASES,
  ...CARD_SELECTION_CASES,
  ...TUTOR_CASES,
  ...INTERACTION_CASES,
  ...BOARD_WIPE_CASES,
  ...PROTECTION_CASES,
  ...RECURSION_CASES,
  ...GRAVEYARD_HATE_CASES,
];

/** Cases labeled with a role the classifier is known to miss today. */
export const KNOWN_GAP_CASES: GoldenCase[] = GOLDEN_SET.filter((c) =>
  c.note?.startsWith('KNOWN GAP'),
);
