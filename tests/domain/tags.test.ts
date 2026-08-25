import { describe, expect, it } from 'vitest';
import { analyzeDeckTags, classifyCardTags } from '@/domain/tags';
import { CARD_TAGS, type CardTag } from '@/domain/types';
import { realCard } from '../fixtures/roleCards';
import { basicLand, legendaryCreature, makeCard } from '../fixtures/cards';

/**
 * Semantic specification for strategy tags. Cards use real Oracle text
 * captured from the live Scryfall API.
 */

const tagsOf = (name: string): CardTag[] => [
  ...new Set(classifyCardTags(realCard(name)).assignments.map((a) => a.tag)),
];
const expectTag = (name: string, tag: CardTag) =>
  expect(tagsOf(name), `${name} should be ${tag}`).toContain(tag);
const expectNoTag = (name: string, tag: CardTag) =>
  expect(tagsOf(name), `${name} should NOT be ${tag}`).not.toContain(tag);

describe('a card type alone never implies participation', () => {
  it('Sol Ring is an Artifact with no artifact tag', () => {
    for (const t of ['artifact_generation', 'artifact_payoff', 'artifact_cost_reduction', 'artifact_sacrifice'] as const) {
      expectNoTag('Sol Ring', t);
    }
  });

  it('Teferi is a Planeswalker with no planeswalker tag', () => {
    for (const t of ['planeswalker_payoff', 'planeswalker_generation', 'planeswalker_doubling'] as const) {
      expectNoTag('Teferi, Hero of Dominaria', t);
    }
  });

  it('Smothering Tithe is an Enchantment with no enchantment tag', () => {
    for (const t of ['enchantment_generation', 'enchantment_payoff', 'enchantment_cost_reduction', 'aura'] as const) {
      expectNoTag('Smothering Tithe', t);
    }
    // It does make Treasure, so it IS token generation.
    expectTag('Smothering Tithe', 'token_generation');
  });

  it('Counterspell and Ponder get no spell-strategy tag', () => {
    for (const name of ['Counterspell', 'Ponder']) {
      for (const t of ['spell_payoff', 'spell_copy', 'spell_cost_reduction', 'spell_recursion'] as const) {
        expectNoTag(name, t);
      }
    }
  });
});

describe('opposing a mechanic is not participating in it', () => {
  it.each(['Solemnity', 'Vampire Hexmage'])('%s gets no counter tag', (name) => {
    for (const t of ['counter_generation', 'counter_payoff', 'counter_doubling', 'proliferate', 'plus_one_counters'] as const) {
      expectNoTag(name, t);
    }
  });

  it('a -1/-1 removal spell is not counter generation', () => {
    const instill = makeCard({
      name: 'Instill Infection',
      typeLine: 'Instant',
      oracleText: 'Put a -1/-1 counter on target creature.\nDraw a card.',
    });
    const tags = classifyCardTags(instill).assignments.map((a) => a.tag);
    expect(tags).not.toContain('counter_generation');
  });
});

describe('tokens created for someone else are not yours', () => {
  it.each(['Pongify', 'Beast Within'])('%s is not token generation', (name) => {
    expectNoTag(name, 'token_generation');
  });

  it('Bitterblossom is token generation', () => expectTag('Bitterblossom', 'token_generation'));
});

describe('plus_one_counters is narrower than counter tags', () => {
  it.each([
    ['Walking Ballista', 'removes counters as a resource'],
    ['Hangarback Walker', 'reads "for each +1/+1 counter"'],
    ['Forgotten Ancient', 'moves counters between creatures'],
  ])('%s has plus_one_counters (%s)', (name) => expectTag(name, 'plus_one_counters'));

  it.each([
    ['Hardened Scales', 'only a replacement effect'],
    ['Fathom Mage', 'only reacts to counters'],
    ['Kami of Whispered Hopes', 'doubles but never moves or removes'],
  ])('%s does NOT have plus_one_counters (%s)', (name) => expectNoTag(name, 'plus_one_counters'));
});

describe('token_payoff requires real synergy, not mere compatibility', () => {
  it.each(['Skullclamp', "Ashnod's Altar", 'Impact Tremors', 'Intangible Virtue'])(
    '%s is a token payoff',
    (name) => expectTag(name, 'token_payoff'),
  );

  it('Viscera Seer is a sacrifice outlet, not a token payoff', () => {
    expectTag('Viscera Seer', 'sacrifice_outlet');
    expectNoTag('Viscera Seer', 'token_payoff');
  });

  it('names the exception rule for the contextual payoffs', () => {
    const assignments = classifyCardTags(realCard('Skullclamp')).assignments;
    expect(assignments).toEqual(
      expect.arrayContaining([{ tag: 'token_payoff', ruleId: 'known-tag-exception' }]),
    );
  });
});

describe('graveyard filling requires deliberate self-fill', () => {
  it('Entomb fills the graveyard', () => expectTag('Entomb', 'graveyard_filling'));

  it('a discard cost does not fill the graveyard as a strategy', () => {
    const gnomes = makeCard({
      name: 'Patchwork Gnomes',
      typeLine: 'Artifact Creature — Gnome',
      oracleText: 'Discard a card: Regenerate this creature.',
    });
    expect(classifyCardTags(gnomes).assignments.map((a) => a.tag)).not.toContain(
      'graveyard_filling',
    );
  });

  it('looting does not fill the graveyard as a strategy', () => {
    const raider = makeCard({
      name: 'Keldon Raider',
      typeLine: 'Creature — Human Warrior',
      oracleText: 'When this creature enters, you may discard a card. If you do, draw a card.',
    });
    expect(classifyCardTags(raider).assignments.map((a) => a.tag)).not.toContain(
      'graveyard_filling',
    );
  });
});

describe('per-family positive coverage', () => {
  it.each<[string, CardTag]>([
    ['Hardened Scales', 'counter_doubling'],
    ['Evolution Sage', 'proliferate'],
    ['Evolution Sage', 'planeswalker_payoff'],
    ['Walking Ballista', 'counter_generation'],
    ['Walking Ballista', 'counter_payoff'],
    ['Parallel Lives', 'token_doubling'],
    ['Viscera Seer', 'sacrifice_outlet'],
    ['Reassembling Skeleton', 'sacrifice_fodder'],
    ['Mayhem Devil', 'sacrifice_payoff'],
    ['Blood Artist', 'death_payoff'],
    ['Entomb', 'graveyard_filling'],
    ["Stitcher's Supplier", 'self_mill'],
    ['Wonder', 'graveyard_payoff'],
    ['Underworld Breach', 'reanimation'],
    ['Sai, Master Thopterist', 'artifact_generation'],
    ['Krark-Clan Ironworks', 'artifact_payoff'],
    ['Starfield Mystic', 'enchantment_cost_reduction'],
    ['Krark-Clan Ironworks', 'artifact_sacrifice'],
    ["Sythis, Harvest's Hand", 'enchantment_payoff'],
    ['Ethereal Armor', 'aura'],
    ['Young Pyromancer', 'spell_payoff'],
    ['Thousand-Year Storm', 'spell_copy'],
    ['Past in Flames', 'spell_recursion'],
    ['Tatyova, Benthic Druid', 'landfall'],
    ['The Gitrog Monster', 'land_payoff'],
    ['Crucible of Worlds', 'land_recursion'],
    ['Etali, Primal Storm', 'attack_payoff'],
    ['Edric, Spymaster of Trest', 'combat_damage_payoff'],
    ['Aurelia, the Warleader', 'extra_combat'],
    ["Light-Paws, Emperor's Voice", 'voltron'],
    ['Craterhoof Behemoth', 'go_wide_payoff'],
    ['The Chain Veil', 'planeswalker_payoff'],
    ['Spark Double', 'planeswalker_generation'],
    ['Doubling Season', 'planeswalker_doubling'],
  ])('%s has %s', (name, tag) => expectTag(name, tag));
});

describe('cards with no strategy participation', () => {
  it.each(['Cultivate', 'Windswept Heath'])('%s gets no land tag', (name) => {
    for (const t of ['landfall', 'land_payoff', 'land_recursion'] as const) expectNoTag(name, t);
  });

  it('Propaganda gets no combat tag', () => {
    for (const t of ['attack_payoff', 'combat_damage_payoff', 'extra_combat', 'voltron', 'go_wide_payoff'] as const) {
      expectNoTag('Propaganda', t);
    }
  });

  it('a vanilla creature and a basic land get nothing', () => {
    expect(classifyCardTags(makeCard({ typeLine: 'Creature — Bear', oracleText: '' })).assignments).toEqual([]);
    expect(classifyCardTags(basicLand('Forest', 'G')).assignments).toEqual([]);
  });
});

describe('rule provenance', () => {
  it('reports scryfallId as cardId', () => {
    const card = realCard('Sol Ring');
    expect(classifyCardTags(card).cardId).toBe(card.scryfallId);
  });

  it('gives every assignment a kebab-case ruleId', () => {
    for (const name of ['Walking Ballista', 'Doubling Season', 'Sai, Master Thopterist']) {
      for (const a of classifyCardTags(realCard(name)).assignments) {
        expect(a.ruleId).toMatch(/^[a-z][a-z0-9-]*$/);
      }
    }
  });

  it('never emits duplicate tag+ruleId pairs', () => {
    for (const name of ['Walking Ballista', 'Doubling Season', 'Storm-Kiln Artist']) {
      const pairs = classifyCardTags(realCard(name)).assignments.map((a) => `${a.tag}:${a.ruleId}`);
      expect(new Set(pairs).size).toBe(pairs.length);
    }
  });
});

describe('analyzeDeckTags', () => {
  const ballista = realCard('Walking Ballista');

  it('always includes every tag key', () => {
    const profile = analyzeDeckTags({ commanders: [], mainboard: [] });
    expect(Object.keys(profile.counts).sort()).toEqual([...CARD_TAGS].sort());
    for (const t of CARD_TAGS) {
      expect(profile.counts[t]).toBe(0);
      expect(profile.cardsByTag[t]).toEqual([]);
    }
  });

  it('weights counts by quantity while listing the name once', () => {
    const profile = analyzeDeckTags({ commanders: [], mainboard: [{ card: ballista, quantity: 3 }] });
    expect(profile.counts.plus_one_counters).toBe(3);
    expect(profile.cardsByTag.plus_one_counters).toEqual(['Walking Ballista']);
  });

  it('classifies commanders and lists them first', () => {
    const profile = analyzeDeckTags({
      commanders: [realCard('Tatyova, Benthic Druid')],
      mainboard: [{ card: realCard('Lotus Cobra'), quantity: 1 }],
    });
    expect(profile.cardsByTag.landfall).toEqual(['Tatyova, Benthic Druid', 'Lotus Cobra']);
    expect(profile.counts.landfall).toBe(2);
  });

  it('counts a card once per tag even when two rules fire for it', () => {
    // Walking Ballista matches counter_generation via two separate rules.
    const profile = analyzeDeckTags({ commanders: [], mainboard: [{ card: ballista, quantity: 1 }] });
    expect(profile.counts.counter_generation).toBe(1);
  });

  it('ignores cards with no tags', () => {
    const profile = analyzeDeckTags({
      commanders: [legendaryCreature('Plain Commander', ['W'])],
      mainboard: [{ card: basicLand('Plains', 'W'), quantity: 37 }],
    });
    for (const t of CARD_TAGS) expect(profile.counts[t]).toBe(0);
  });
});
