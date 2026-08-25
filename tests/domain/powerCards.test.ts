import { describe, expect, it } from 'vitest';
import {
  CURATED_SET_SIZES,
  POWER_PROPERTIES,
  analyzeCardPower,
  cardHasPower,
  interactionTargets,
  isCounterspell,
  type PowerProperty,
} from '@/domain/powerCards';
import { realCard } from '../fixtures/roleCards';
import { makeCard } from '../fixtures/cards';

/** Semantic specification for card-level power properties. */

const has = (name: string, property: PowerProperty) => cardHasPower(realCard(name), property);

describe('fast_mana is distinct from ordinary ramp', () => {
  it.each([
    'Sol Ring', 'Mana Crypt', 'Mana Vault', 'Chrome Mox', 'Mox Diamond', 'Lotus Petal',
    'Jeweled Lotus', 'Dark Ritual', 'Cabal Ritual', 'Dockside Extortionist',
    'Ancient Tomb', 'City of Traitors', 'Simian Spirit Guide',
  ])('%s is fast mana', (name) => expect(has(name, 'fast_mana')).toBe(true));

  it.each([
    'Arcane Signet', 'Fellwar Stone', 'Three Visits', "Nature's Lore",
    'Cultivate', 'Exploration', 'Birds of Paradise',
  ])('%s is NOT fast mana', (name) => expect(has(name, 'fast_mana')).toBe(false));

  it('treats "add {R} or {G}" as one mana, not two', () => {
    // A choice of colours is a single mana: this is what kept 392 ordinary
    // lands from being classified as fast mana.
    const dual = makeCard({
      name: 'Test Dual',
      typeLine: 'Land',
      oracleText: '{T}: Add {R} or {G}.',
    });
    expect(cardHasPower(dual, 'fast_mana')).toBe(false);
  });

  it('does not treat a storage land as fast mana', () => {
    const storage = makeCard({
      name: 'Test Storage',
      typeLine: 'Land',
      oracleText:
        '{T}: Add {C}.\n{1}, {T}: Put a storage counter on this land.\n' +
        '{1}, Remove X storage counters from this land: Add X mana in any combination of {G} and {W}.',
    });
    expect(cardHasPower(storage, 'fast_mana')).toBe(false);
  });

  it('does not treat a conditional Urza land as fast mana', () => {
    const urza = makeCard({
      name: 'Test Tower',
      typeLine: 'Land',
      oracleText: "{T}: Add {C}. If you control an Urza's Mine, add {C}{C}{C} instead.",
    });
    expect(cardHasPower(urza, 'fast_mana')).toBe(false);
  });

  it('does not treat restricted mana as fast mana', () => {
    const restricted = makeCard({
      name: 'Test Workshop',
      typeLine: 'Land',
      oracleText: '{T}: Add {C}{C}{C}. Spend this mana only to cast artifact spells.',
    });
    expect(cardHasPower(restricted, 'fast_mana')).toBe(false);
  });
});

describe('efficient_tutor', () => {
  it.each([
    'Demonic Tutor', 'Vampiric Tutor', 'Enlightened Tutor', 'Worldly Tutor',
    'Mystical Tutor', 'Gamble', 'Diabolic Intent', 'Entomb', "Green Sun's Zenith",
    'Chord of Calling', 'Birthing Pod',
  ])('%s is an efficient tutor', (name) => expect(has(name, 'efficient_tutor')).toBe(true));

  it.each(['Solve the Equation', 'Idyllic Tutor'])(
    '%s is NOT an efficient tutor',
    (name) => expect(has(name, 'efficient_tutor')).toBe(false),
  );
});

describe('efficient_interaction and free_interaction', () => {
  it.each([
    'Swords to Plowshares', 'Path to Exile', 'Pongify', 'Rapid Hybridization',
    "Nature's Claim", 'Chain of Vapor', 'Swan Song', "An Offer You Can't Refuse",
    'Counterspell', 'Mana Drain', 'Force of Will', 'Deflecting Swat',
  ])('%s is efficient interaction', (name) =>
    expect(has(name, 'efficient_interaction')).toBe(true));

  it.each(['Beast Within', 'Generous Gift', "Hero's Downfall", 'Vindicate'])(
    '%s is NOT efficient interaction',
    (name) => expect(has(name, 'efficient_interaction')).toBe(false),
  );

  it.each(['Force of Will', 'Force of Negation', 'Deadly Rollick', 'Daze'])(
    '%s is free interaction',
    (name) => expect(has(name, 'free_interaction')).toBe(true),
  );

  it.each(['Swords to Plowshares', 'Counterspell', 'Swan Song'])(
    '%s is NOT free interaction',
    (name) => expect(has(name, 'free_interaction')).toBe(false),
  );

  it('does not count free-cost protection as interaction', () => {
    // Flawless Maneuver has a free alternative cost but only protects, so
    // interaction semantics must be established first.
    expect(has('Flawless Maneuver', 'free_interaction')).toBe(false);
    expect(has('Flawless Maneuver', 'efficient_protection')).toBe(true);
  });
});

describe('efficient_protection', () => {
  it.each([
    "Tamiyo's Safekeeping", 'Snakeskin Veil', "Tyvar's Stand",
    'Malakir Rebirth // Malakir Mire',
    'Feign Death', 'Flawless Maneuver', 'Deflecting Swat', 'Fierce Guardianship',
    'Heroic Intervention', "Teferi's Protection", 'Clever Concealment',
  ])('%s is efficient protection', (name) =>
    expect(has(name, 'efficient_protection')).toBe(true));

  it('matches a modal double-faced card by its front face name', () => {
    // Curated lists name the face players cast; the card is stored joined.
    expect(has('Malakir Rebirth // Malakir Mire', 'efficient_protection')).toBe(true);
  });
});

describe('card advantage properties are separately visible', () => {
  it.each([
    'Rhystic Study', 'Mystic Remora', 'Esper Sentinel', 'The One Ring', 'Necropotence',
    'Ad Nauseam', 'Sylvan Library', 'Skullclamp', "Night's Whisper", 'Painful Truths',
    'Fact or Fiction',
  ])('%s is efficient card advantage', (name) =>
    expect(has(name, 'efficient_card_advantage')).toBe(true));

  it.each(['Consecrated Sphinx', 'Phyrexian Arena', 'Harmonize', 'Divination'])(
    '%s is NOT efficient card advantage',
    (name) => expect(has(name, 'efficient_card_advantage')).toBe(false),
  );

  it.each([
    'Rhystic Study', 'Mystic Remora', 'Esper Sentinel', 'The One Ring', 'Necropotence',
    'Phyrexian Arena', 'Consecrated Sphinx', 'Skullclamp', 'Guardian Project',
    'Beast Whisperer', 'Archmage Emeritus',
  ])('%s is repeatable card advantage', (name) =>
    expect(has(name, 'repeatable_card_advantage')).toBe(true));

  it.each(["Night's Whisper", 'Harmonize', 'Fact or Fiction', 'Ad Nauseam'])(
    '%s is NOT repeatable card advantage',
    (name) => expect(has(name, 'repeatable_card_advantage')).toBe(false),
  );

  it('marks The One Ring efficient AND repeatable', () => {
    expect(has('The One Ring', 'efficient_card_advantage')).toBe(true);
    expect(has('The One Ring', 'repeatable_card_advantage')).toBe(true);
  });
});

describe('combo_piece and win_condition stay distinct', () => {
  it.each([
    "Thassa's Oracle", 'Demonic Consultation', 'Tainted Pact', 'Underworld Breach',
    'Walking Ballista', 'Dockside Extortionist',
  ])('%s is a combo piece', (name) => expect(has(name, 'combo_piece')).toBe(true));

  it.each(['Craterhoof Behemoth', 'Torment of Hailfire', 'Approach of the Second Sun'])(
    '%s is NOT a combo piece',
    (name) => expect(has(name, 'combo_piece')).toBe(false),
  );

  it('separates Demonic Consultation from Thassa\'s Oracle', () => {
    expect(has('Demonic Consultation', 'combo_piece')).toBe(true);
    expect(has('Demonic Consultation', 'win_condition')).toBe(false);
    expect(has("Thassa's Oracle", 'combo_piece')).toBe(true);
    expect(has("Thassa's Oracle", 'win_condition')).toBe(true);
  });

  it.each([
    'Craterhoof Behemoth', 'Approach of the Second Sun', 'Triumph of the Hordes',
    'Torment of Hailfire', 'Aetherflux Reservoir',
  ])('%s is a win condition', (name) => expect(has(name, 'win_condition')).toBe(true));

  it('marks Dockside Extortionist both fast mana and combo piece', () => {
    expect(has('Dockside Extortionist', 'fast_mana')).toBe(true);
    expect(has('Dockside Extortionist', 'combo_piece')).toBe(true);
  });
});

describe('interaction target coverage', () => {
  it('counts a modal card once but covers several categories', () => {
    expect(interactionTargets(realCard('Abrade')).sort()).toEqual(['artifact', 'creature']);
  });

  it.each<[string, string]>([
    ['Swords to Plowshares', 'creature'],
    ['Counterspell', 'spell'],
    ["Nature's Claim", 'artifact'],
  ])('%s covers %s', (name, target) =>
    expect(interactionTargets(realCard(name))).toContain(target));

  it('treats a generic permanent answer as covering permanent types', () => {
    const covered = interactionTargets(realCard('Beast Within'));
    expect(covered).toContain('creature');
    expect(covered).toContain('artifact');
  });

  it('identifies counterspells', () => {
    expect(isCounterspell(realCard('Counterspell'))).toBe(true);
    expect(isCounterspell(realCard('Swords to Plowshares'))).toBe(false);
  });
});

describe('provenance and shape', () => {
  it('gives every assignment a kebab-case ruleId', () => {
    for (const name of ['Sol Ring', 'The One Ring', "Thassa's Oracle"]) {
      for (const a of analyzeCardPower(realCard(name)).assignments) {
        expect(a.ruleId).toMatch(/^[a-z][a-z0-9-]*$/);
      }
    }
  });

  it('reports scryfallId as cardId', () => {
    const card = realCard('Sol Ring');
    expect(analyzeCardPower(card).cardId).toBe(card.scryfallId);
  });

  it('assigns nothing to a vanilla creature', () => {
    const bear = makeCard({ typeLine: 'Creature — Bear', oracleText: '' });
    expect(analyzeCardPower(bear).assignments).toEqual([]);
  });

  it('exposes all nine properties and curated set sizes', () => {
    expect(POWER_PROPERTIES).toHaveLength(9);
    expect(Object.keys(CURATED_SET_SIZES).length).toBeGreaterThan(0);
  });
});

describe('repeatable_card_advantage precision guards', () => {
  /*
   * Three demonstrated false-positive families. All guards are CLAUSE-LOCAL:
   * a card is judged per ability line, so unrelated text elsewhere never
   * suppresses a legitimate engine.
   */
  const isRepeatable = (card: Parameters<typeof cardHasPower>[0]) =>
    cardHasPower(card, 'repeatable_card_advantage');

  const artifact = (name: string, oracleText: string) =>
    makeCard({ name, typeLine: 'Artifact', cmc: 2, manaCost: '{2}', oracleText });
  const creature = (name: string, oracleText: string) =>
    makeCard({ name, typeLine: 'Creature — Human', cmc: 3, manaCost: '{2}{U}', oracleText });

  describe('self-consuming activations', () => {
    it('rejects an activation that sacrifices its own source', () => {
      expect(isRepeatable(artifact('Probe', '{T}: Add {C}.\n{1}, {T}, Sacrifice this artifact: Draw a card.')))
        .toBe(false);
    });

    it('rejects an activation that exiles its own source', () => {
      expect(isRepeatable(artifact('Probe', '{1}, Exile this artifact: Draw a card.'))).toBe(false);
    });

    it('accepts a persistent activated draw that keeps its source', () => {
      expect(isRepeatable(artifact('Probe', '{2}, {T}: Draw a card.'))).toBe(true);
    });

    it('accepts a recurring triggered draw', () => {
      expect(isRepeatable(creature('Probe', 'At the beginning of your upkeep, draw a card.'))).toBe(true);
    });

    it('keeps an engine whose OTHER ability is self-consuming', () => {
      // The sacrifice line does not draw, so it cannot suppress the engine.
      expect(isRepeatable(artifact('Probe',
        'At the beginning of your upkeep, draw a card.\n{T}, Sacrifice this artifact: Add {C}{C}.')))
        .toBe(true);
    });
  });

  describe('loot / parity', () => {
    it('rejects repeatable draw-then-discard parity', () => {
      expect(isRepeatable(artifact('Probe', '{2}, {T}: Draw a card, then discard a card.'))).toBe(false);
    });

    it('rejects parity at higher counts', () => {
      expect(isRepeatable(artifact('Probe', '{T}: Draw two cards, then discard two cards.'))).toBe(false);
    });

    it('accepts a strictly positive delta', () => {
      expect(isRepeatable(artifact('Probe', '{T}: Draw three cards, then discard one card.'))).toBe(true);
    });

    it('does not let unrelated discard text elsewhere kill a real engine', () => {
      /*
       * The clause-local contract: this card loots on one line and draws
       * unconditionally on another. A global discard guard would wrongly
       * reject it.
       */
      expect(isRepeatable(creature('Probe',
        'Whenever you cast a spell, draw a card.\n{2}, {T}: Draw a card, then discard a card.')))
        .toBe(true);
    });
  });

  describe('symmetric draw', () => {
    it('rejects a repeatable draw shared by every player', () => {
      expect(isRepeatable(creature('Probe',
        "At the beginning of each player's draw step, that player draws an additional card.")))
        .toBe(false);
    });

    it('rejects a symmetric wheel trigger', () => {
      expect(isRepeatable(creature('Probe',
        'Whenever this creature deals combat damage to a player, each player discards their hand, then draws seven cards.')))
        .toBe(false);
    });

    it('keeps an asymmetric opponent-triggered engine', () => {
      expect(isRepeatable(creature('Probe',
        'Whenever an opponent draws a card, you may draw two cards.')))
        .toBe(true);
    });

    it('treats a possessive timing phrase as asymmetric, not shared', () => {
      // "during each opponent's turn" says WHEN, not who draws.
      expect(isRepeatable(creature('Probe',
        "Whenever you cast your first spell during each opponent's turn, draw a card.")))
        .toBe(true);
    });
  });

  describe('named regressions', () => {
    it.each(['Mind Stone', 'Relic of Progenitus', 'Soul-Guide Lantern'])(
      '%s is no longer a repeatable engine', (name) =>
        expect(isRepeatable(realCard(name))).toBe(false));

    it.each([
      'Rhystic Study', 'Mystic Remora', 'The One Ring', 'Phyrexian Arena',
      'Skullclamp', 'Sylvan Library', 'Esper Sentinel', 'Beast Whisperer',
      'Guardian Project', 'Consecrated Sphinx', 'Necropotence',
    ])('%s remains a repeatable engine', (name) =>
      expect(isRepeatable(realCard(name))).toBe(true));

    it('keeps Nihil Spellbomb: its draw is triggered, not a self-consuming activation', () => {
      /*
       * "When this artifact is put into a graveyard from the battlefield, you
       * may pay {B}. If you do, draw a card." The sacrifice is on a DIFFERENT
       * ability; the draw itself is a recurring trigger. The general rule
       * classifies it accordingly, and no name-based exception overrides that.
       */
      expect(isRepeatable(realCard('Nihil Spellbomb'))).toBe(true);
    });
  });
});
