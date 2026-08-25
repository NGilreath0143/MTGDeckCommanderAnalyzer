import { describe, expect, it } from 'vitest';
import { confidenceFor, inferDeckArchetypes } from '@/domain/archetypes';
import { analyzeDeckStrategy } from '@/domain/strategy';
import {
  ARCHETYPE_INFERENCE_TYPES,
  type ArchetypeInference,
  type ArchetypeInferenceType,
  type DeckComposition,
  type ResolvedCard,
} from '@/domain/types';
import { basicLand, makeCard } from '../fixtures/cards';
import { realCard } from '../fixtures/roleCards';

/** Semantic specification for archetype and theme inference. */

function infer(composition: DeckComposition): Map<ArchetypeInferenceType, ArchetypeInference> {
  const strategy = analyzeDeckStrategy(composition);
  return new Map(
    inferDeckArchetypes(composition, strategy).inferences.map((i) => [i.archetype, i]),
  );
}

const one = (composition: DeckComposition, type: ArchetypeInferenceType) => {
  const i = infer(composition).get(type);
  if (!i) throw new Error(`no inference for ${type}`);
  return i;
};

/** Build a composition from repeated real cards. */
function build(
  entries: [string, number][],
  commanders: string[] = [],
  pad = 0,
): DeckComposition {
  const mainboard = entries.map(([name, quantity]) => ({ card: realCard(name), quantity }));
  if (pad > 0) mainboard.push({ card: basicLand('Forest', 'G'), quantity: pad });
  return { commanders: commanders.map(realCard), mainboard };
}

/** A synthetic card carrying a chosen behaviour, for precise anchor tests. */
const synth = (name: string, typeLine: string, oracleText: string): ResolvedCard =>
  makeCard({ name, typeLine, oracleText });

const many = (card: ResolvedCard, quantity: number) => ({ card, quantity });

// ---------------------------------------------------------------------------
// Shared shape
// ---------------------------------------------------------------------------

describe('profile shape', () => {
  it('returns all 14 inferences in declared order', () => {
    const profile = analyzeDeckStrategy({ commanders: [], mainboard: [] });
    const result = inferDeckArchetypes({ commanders: [], mainboard: [] }, profile);
    expect(result.inferences.map((i) => i.archetype)).toEqual([...ARCHETYPE_INFERENCE_TYPES]);
  });

  it('marks every inference unsatisfied and zero for an empty deck', () => {
    for (const i of infer({ commanders: [], mainboard: [] }).values()) {
      expect(i.anchorSatisfied).toBe(false);
      expect(i.score).toBe(0);
      expect(i.confidence).toBe('weak');
      // Evidence must still explain the failure.
      expect(i.evidence.length).toBeGreaterThan(0);
    }
  });

  it('labels archetypes and themes correctly', () => {
    const result = infer({ commanders: [], mainboard: [] });
    for (const t of ['aristocrats', 'reanimator', 'superfriends', 'spellslinger', 'voltron', 'aura_voltron', 'enchantress'] as const) {
      expect(result.get(t)?.kind, t).toBe('archetype');
    }
    for (const t of ['counters', 'proliferate', 'tokens', 'go_wide', 'artifacts', 'landfall', 'lands'] as const) {
      expect(result.get(t)?.kind, t).toBe('theme');
    }
  });

  it('keeps scores within 0-100', () => {
    const composition = build([['Bitterblossom', 30], ['Intangible Virtue', 30], ['Viscera Seer', 30]]);
    for (const i of infer(composition).values()) {
      expect(i.score).toBeGreaterThanOrEqual(0);
      expect(i.score).toBeLessThanOrEqual(100);
    }
  });

  it('is deterministic', () => {
    const c = build([['Bitterblossom', 6]], ['Purphoros, God of the Forge']);
    const a = inferDeckArchetypes(c, analyzeDeckStrategy(c));
    const b = inferDeckArchetypes(c, analyzeDeckStrategy(c));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('confidence bands', () => {
  it.each([
    [0, 'weak'],
    [29, 'weak'],
    [30, 'possible'],
    [49, 'possible'],
    [50, 'likely'],
    [69, 'likely'],
    [70, 'defining'],
    [100, 'defining'],
  ])('%i is %s', (score, expected) => expect(confidenceFor(score)).toBe(expected));
});

// ---------------------------------------------------------------------------
// Aristocrats
// ---------------------------------------------------------------------------

describe('aristocrats', () => {
  it('fires with outlet + payoff + fodder', () => {
    const i = one(
      build([
        ['Viscera Seer', 3],
        ['Blood Artist', 3],
        ['Bitterblossom', 4],
      ]),
      'aristocrats',
    );
    expect(i.anchorSatisfied).toBe(true);
    expect(i.score).toBeGreaterThan(0);
  });

  it('accepts recursion as fodder with no tokens at all', () => {
    const i = one(
      build([
        ['Viscera Seer', 5],
        ['Blood Artist', 8],
        ['Reanimate', 10],
      ]),
      'aristocrats',
    );
    expect(i.anchorSatisfied).toBe(true);
  });

  it('does NOT fire on many token generators with no outlet or payoff', () => {
    const i = one(build([['Bitterblossom', 15]]), 'aristocrats');
    expect(i.anchorSatisfied).toBe(false);
    expect(i.score).toBe(0);
  });

  it('does NOT fire on death triggers without a voluntary outlet', () => {
    const i = one(build([['Blood Artist', 8], ['Bitterblossom', 6]]), 'aristocrats');
    expect(i.anchorSatisfied).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Reanimator
// ---------------------------------------------------------------------------

describe('reanimator', () => {
  it('fires on reanimation with graveyard filling', () => {
    const i = one(build([['Reanimate', 6], ['Entomb', 4]]), 'reanimator');
    expect(i.anchorSatisfied).toBe(true);
    expect(i.score).toBeGreaterThan(0);
  });

  it('still fires on reanimation-heavy decks with little filling, more weakly', () => {
    const heavy = one(build([['Reanimate', 10]]), 'reanimator');
    const full = one(build([['Reanimate', 10], ['Entomb', 7]]), 'reanimator');
    expect(heavy.anchorSatisfied).toBe(true);
    expect(full.score).toBeGreaterThan(heavy.score);
  });

  it('does NOT count land-only recursion as reanimation', () => {
    // Crucible-style land recursion carries the Phase 3A reanimation tag but
    // is a Lands-theme effect, not Reanimator.
    const i = one(
      build([['Crucible of Worlds', 2], ['Ramunap Excavator', 2], ['Life from the Loam', 2]]),
      'reanimator',
    );
    expect(i.anchorSatisfied).toBe(false);
    expect(i.score).toBe(0);
    expect(i.evidence.find((e) => e.id === 'anchor.landOnlyExcluded')?.value).toBeGreaterThan(0);
  });

  it('does NOT treat a land-returning commander as a reanimator engine', () => {
    const i = one(
      build([['Reanimate', 3]], ['Titania, Protector of Argoth']),
      'reanimator',
    );
    expect(i.evidence.find((e) => e.id === 'commander.engine')?.value).toBe(false);
    expect(i.evidence.find((e) => e.id === 'commander.landOnly')?.value).toBe(true);
  });

  it('counts creature reanimation from a commander', () => {
    const i = one(build([['Reanimate', 3]], ['Sun Titan']), 'reanimator');
    expect(i.evidence.find((e) => e.id === 'commander.engine')?.value).toBe(true);
  });

  it('does NOT fire on a couple of incidental recursion cards', () => {
    const i = one(build([['Regrowth', 1], ['Eternal Witness', 1]]), 'reanimator');
    expect(i.anchorSatisfied).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Superfriends
// ---------------------------------------------------------------------------

describe('superfriends', () => {
  const pw = (i: number) => synth(`Walker ${i}`, 'Legendary Planeswalker — Test', '+1: Draw a card.');

  it('fires on planeswalker density', () => {
    const composition = { commanders: [], mainboard: [many(pw(1), 15)] };
    const i = one(composition, 'superfriends');
    expect(i.anchorSatisfied).toBe(true);
    expect(i.score).toBeGreaterThan(0);
  });

  it('does NOT fire on generic counter support with few planeswalkers', () => {
    const composition = {
      commanders: [],
      mainboard: [many(pw(1), 4), { card: realCard('Walking Ballista'), quantity: 10 }],
    };
    expect(one(composition, 'superfriends').anchorSatisfied).toBe(false);
  });

  it('does NOT fire on an Atraxa-style proliferate deck with no planeswalkers', () => {
    const i = one(
      build([['Evolution Sage', 8], ['Walking Ballista', 5]], ["Atraxa, Praetors' Voice"]),
      'superfriends',
    );
    expect(i.anchorSatisfied).toBe(false);
    expect(i.score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Spellslinger
// ---------------------------------------------------------------------------

describe('spellslinger', () => {
  const spell = (i: number) => synth(`Bolt ${i}`, 'Instant', 'Deal 3 damage to any target.');

  it('fires on payoff plus real spell infrastructure', () => {
    const composition = {
      commanders: [],
      mainboard: [
        { card: realCard('Young Pyromancer'), quantity: 4 },
        { card: realCard('Thousand-Year Storm'), quantity: 2 },
        many(spell(1), 20),
      ],
    };
    const i = one(composition, 'spellslinger');
    expect(i.anchorSatisfied).toBe(true);
  });

  it('does NOT fire on raw instant/sorcery density alone', () => {
    const composition = { commanders: [], mainboard: [many(spell(1), 30)] };
    const i = one(composition, 'spellslinger');
    expect(i.anchorSatisfied).toBe(false);
    expect(i.score).toBe(0);
  });

  it('does NOT fire on two payoffs with no copy/reduction/recursion', () => {
    // The Tokens/Aristocrats shape: spell_payoff=2, zero infrastructure, no
    // commander engine. High instant/sorcery density must not rescue it.
    const composition = {
      commanders: [],
      mainboard: [{ card: realCard('Young Pyromancer'), quantity: 2 }, many(spell(1), 25)],
    };
    const i = one(composition, 'spellslinger');
    expect(i.anchorSatisfied).toBe(false);
    expect(i.score).toBe(0);
  });

  it('fires on three or more payoffs even without other infrastructure', () => {
    const composition = {
      commanders: [],
      mainboard: [{ card: realCard('Young Pyromancer'), quantity: 3 }, many(spell(1), 4)],
    };
    expect(one(composition, 'spellslinger').anchorSatisfied).toBe(true);
  });

  it('fires on two payoffs once infrastructure is present', () => {
    const composition = {
      commanders: [],
      mainboard: [
        { card: realCard('Young Pyromancer'), quantity: 2 },
        { card: realCard('Thousand-Year Storm'), quantity: 1 },
        many(spell(1), 14),
      ],
    };
    expect(one(composition, 'spellslinger').anchorSatisfied).toBe(true);
  });

  it('accepts a commander spell engine in place of high density', () => {
    const composition = {
      commanders: [realCard('Young Pyromancer')],
      mainboard: [{ card: realCard('Thousand-Year Storm'), quantity: 3 }, many(spell(1), 5)],
    };
    expect(one(composition, 'spellslinger').anchorSatisfied).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Voltron and Aura Voltron
// ---------------------------------------------------------------------------

describe('voltron', () => {
  it('fires on concentrated enhancement', () => {
    const i = one(build([['Nettlecyst', 4]]), 'voltron');
    expect(i.anchorSatisfied).toBe(true);
  });

  it('does NOT fire on generic protection alone', () => {
    const i = one(
      build([['Heroic Intervention', 5], ['Swiftfoot Boots', 4], ['Lightning Greaves', 3]]),
      'voltron',
    );
    expect(i.anchorSatisfied).toBe(false);
    expect(i.score).toBe(0);
  });

  it('does NOT fire on a go-wide token deck', () => {
    const i = one(build([['Bitterblossom', 10], ['Craterhoof Behemoth', 2]]), 'voltron');
    expect(i.anchorSatisfied).toBe(false);
  });
});

describe('aura voltron', () => {
  const aura = (i: number) =>
    synth(`Buff ${i}`, 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +2/+2.');

  it('records voltron as its parent', () => {
    const i = one(build([['Nettlecyst', 1]]), 'aura_voltron');
    expect(i.parent).toBe('voltron');
  });

  it('fires with a voltron foundation plus auras', () => {
    const composition = {
      commanders: [realCard("Light-Paws, Emperor's Voice")],
      mainboard: [{ card: realCard('Nettlecyst'), quantity: 3 }, many(aura(1), 10)],
    };
    const i = one(composition, 'aura_voltron');
    expect(i.anchorSatisfied).toBe(true);
    expect(i.score).toBeGreaterThan(0);
  });

  it('does NOT fire on auras without a voltron foundation', () => {
    const composition = { commanders: [], mainboard: [many(aura(1), 12)] };
    const i = one(composition, 'aura_voltron');
    expect(i.anchorSatisfied).toBe(false);
    expect(i.score).toBe(0);
  });

  it('does NOT fire on voltron with almost no auras', () => {
    const i = one(build([['Nettlecyst', 6]]), 'aura_voltron');
    expect(i.anchorSatisfied).toBe(false);
  });

  it('never outranks its parent', () => {
    const composition = {
      commanders: [realCard("Light-Paws, Emperor's Voice")],
      mainboard: [{ card: realCard('Nettlecyst'), quantity: 2 }, many(aura(1), 20)],
    };
    const result = infer(composition);
    const parent = result.get('voltron')!;
    const child = result.get('aura_voltron')!;
    if (child.anchorSatisfied) expect(child.score).toBeLessThanOrEqual(parent.score);
  });
});

// ---------------------------------------------------------------------------
// Enchantress
// ---------------------------------------------------------------------------

describe('enchantress', () => {
  const ench = (i: number) => synth(`Charm ${i}`, 'Enchantment', 'You gain 1 life at end of turn.');

  it('fires on enchantment payoff plus density', () => {
    const composition = {
      commanders: [realCard("Sythis, Harvest's Hand")],
      mainboard: [{ card: realCard('Ethereal Armor'), quantity: 3 }, many(ench(1), 20)],
    };
    const i = one(composition, 'enchantress');
    expect(i.anchorSatisfied).toBe(true);
  });

  it('does NOT fire on 30 enchantments with no payoff', () => {
    const composition = { commanders: [], mainboard: [many(ench(1), 30)] };
    const i = one(composition, 'enchantress');
    expect(i.anchorSatisfied).toBe(false);
    expect(i.score).toBe(0);
  });

  it('scores higher with density once payoff intent exists', () => {
    const sparse = {
      commanders: [],
      mainboard: [{ card: realCard('Ethereal Armor'), quantity: 3 }],
    };
    const dense = {
      commanders: [],
      mainboard: [{ card: realCard('Ethereal Armor'), quantity: 3 }, many(ench(1), 25)],
    };
    expect(one(dense, 'enchantress').score).toBeGreaterThan(one(sparse, 'enchantress').score);
  });
});

// ---------------------------------------------------------------------------
// Counters and Proliferate
// ---------------------------------------------------------------------------

describe('counters theme', () => {
  it('fires on a counter engine', () => {
    const i = one(
      build([['Walking Ballista', 3], ['Hardened Scales', 2], ["Cathars' Crusade", 2]]),
      'counters',
    );
    expect(i.anchorSatisfied).toBe(true);
  });

  it('is not established by planeswalker loyalty alone', () => {
    const loyaltyOnly = synth(
      'Loyal Walker',
      'Legendary Planeswalker — Test',
      'Put a loyalty counter on each planeswalker you control.',
    );
    const composition = { commanders: [], mainboard: [many(loyaltyOnly, 10)] };
    const i = one(composition, 'counters');
    expect(i.evidence.find((x) => x.id === 'anchor.loyaltyOnlyExcluded')?.value).toBeGreaterThan(0);
    expect(i.anchorSatisfied).toBe(false);
  });
});

describe('proliferate theme', () => {
  it('fires with proliferate plus counters worth increasing', () => {
    const i = one(
      build([['Evolution Sage', 4], ['Walking Ballista', 3], ["Cathars' Crusade", 2]]),
      'proliferate',
    );
    expect(i.anchorSatisfied).toBe(true);
  });

  it('does NOT fire on two proliferate cards in a counters deck', () => {
    const i = one(build([['Evolution Sage', 2], ['Walking Ballista', 6]]), 'proliferate');
    expect(i.anchorSatisfied).toBe(false);
  });

  it('does NOT fire on proliferate with no useful counters', () => {
    const i = one(build([['Evolution Sage', 8]]), 'proliferate');
    expect(i.anchorSatisfied).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tokens and Go-Wide
// ---------------------------------------------------------------------------

describe('tokens theme', () => {
  it('fires on token generation', () => {
    const i = one(build([['Bitterblossom', 6]]), 'tokens');
    expect(i.anchorSatisfied).toBe(true);
  });

  it('scores higher with payoff and doubling', () => {
    const bare = one(build([['Bitterblossom', 8]]), 'tokens');
    const engine = one(
      build([['Bitterblossom', 8], ['Intangible Virtue', 4], ['Parallel Lives', 3]]),
      'tokens',
    );
    expect(engine.score).toBeGreaterThan(bare.score);
  });

  it('does NOT fire on a handful of token makers', () => {
    expect(one(build([['Bitterblossom', 2]]), 'tokens').anchorSatisfied).toBe(false);
  });
});

describe('go-wide theme', () => {
  it('requires a mass-creature payoff, not just creature tokens', () => {
    // 12 creature-token generators, zero go_wide_payoff.
    const i = one(build([['Bitterblossom', 12]]), 'go_wide');
    expect(i.anchorSatisfied).toBe(false);
    expect(i.score).toBe(0);
  });

  it('fires when a real go-wide payoff is present', () => {
    const i = one(build([['Craterhoof Behemoth', 2], ['Bitterblossom', 8]]), 'go_wide');
    expect(i.anchorSatisfied).toBe(true);
  });

  it('is not manufactured by Treasure token generation', () => {
    const treasure = synth(
      'Treasure Maker',
      'Enchantment',
      'Whenever an opponent draws a card, you create a Treasure token.',
    );
    const composition = { commanders: [], mainboard: [many(treasure, 12)] };
    const i = one(composition, 'go_wide');
    expect(i.anchorSatisfied).toBe(false);
  });

  it('lets a token Aristocrats deck stay Tokens without becoming Go-Wide', () => {
    const composition = build([
      ['Bitterblossom', 8],
      ['Viscera Seer', 3],
      ['Blood Artist', 3],
    ]);
    const result = infer(composition);
    expect(result.get('tokens')?.anchorSatisfied).toBe(true);
    expect(result.get('aristocrats')?.anchorSatisfied).toBe(true);
    expect(result.get('go_wide')?.anchorSatisfied).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Artifacts
// ---------------------------------------------------------------------------

describe('artifacts theme', () => {
  const utility = (i: number) => synth(`Rock ${i}`, 'Artifact', '{T}: Add {C}.');

  it('does NOT fire on artifact payoff alone', () => {
    // artifact_payoff present, but no generation, sacrifice, reduction, or
    // heavy density to pair it with.
    const composition = {
      commanders: [],
      mainboard: [{ card: realCard('Storm-Kiln Artist'), quantity: 2 }],
    };
    const i = one(composition, 'artifacts');
    expect(i.anchorSatisfied).toBe(false);
  });

  it('fires when payoff is paired with sacrifice', () => {
    const i = one(
      build([['Krark-Clan Ironworks', 3], ['Sai, Master Thopterist', 2]]),
      'artifacts',
    );
    expect(i.anchorSatisfied).toBe(true);
  });

  it('fires on a generation-plus-converter resource engine', () => {
    const i = one(
      build([['Sai, Master Thopterist', 4], ['Krark-Clan Ironworks', 2]]),
      'artifacts',
    );
    expect(i.anchorSatisfied).toBe(true);
  });

  it('does NOT fire on utility artifact density with no engine', () => {
    const composition = { commanders: [], mainboard: [many(utility(1), 20)] };
    const i = one(composition, 'artifacts');
    expect(i.anchorSatisfied).toBe(false);
    expect(i.score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Landfall and Lands
// ---------------------------------------------------------------------------

describe('landfall theme', () => {
  it('fires on landfall density', () => {
    const i = one(build([['Lotus Cobra', 3], ['Scute Swarm', 2]]), 'landfall');
    expect(i.anchorSatisfied).toBe(true);
  });

  it('accepts a commander landfall engine with fewer payoffs', () => {
    const i = one(build([['Lotus Cobra', 2]], ['Tatyova, Benthic Druid']), 'landfall');
    expect(i.anchorSatisfied).toBe(true);
  });

  it('does NOT fire on ramp and fetchlands with one landfall payoff', () => {
    const composition = build([['Cultivate', 8], ['Rampant Growth', 6], ['Lotus Cobra', 1]], [], 40);
    const i = one(composition, 'landfall');
    expect(i.anchorSatisfied).toBe(false);
  });
});

describe('lands theme', () => {
  it('fires on land recursion plus payoff', () => {
    const i = one(
      build([['Crucible of Worlds', 2], ['The Gitrog Monster', 1], ['Oracle of Mul Daya', 1]]),
      'lands',
    );
    expect(i.anchorSatisfied).toBe(true);
  });

  it('is NOT manufactured by generic ramp', () => {
    const composition = build([['Cultivate', 10], ['Rampant Growth', 8]], [], 42);
    const i = one(composition, 'lands');
    expect(i.anchorSatisfied).toBe(false);
    expect(i.score).toBe(0);
  });

  it('is NOT established by landfall alone', () => {
    const i = one(build([['Lotus Cobra', 8], ['Scute Swarm', 4]]), 'lands');
    expect(i.anchorSatisfied).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

describe('diagnostics', () => {
  it('explains why an anchor failed', () => {
    const i = one(build([['Bitterblossom', 1]]), 'aristocrats');
    expect(i.anchorSatisfied).toBe(false);
    const ids = i.evidence.map((e) => e.id);
    expect(ids).toContain('anchor.outlets');
    expect(ids).toContain('anchor.payoffs');
    expect(ids).toContain('anchor.fodder');
  });

  it('records component contributions when satisfied', () => {
    const i = one(build([['Bitterblossom', 8], ['Intangible Virtue', 4]]), 'tokens');
    const ids = i.evidence.map((e) => e.id);
    expect(ids).toContain('component.anchor');
    expect(ids.some((x) => x.startsWith('engine.'))).toBe(true);
    expect(ids.some((x) => x.startsWith('support.'))).toBe(true);
    expect(ids.some((x) => x.startsWith('commander.'))).toBe(true);
    expect(ids.some((x) => x.startsWith('density.'))).toBe(true);
  });

  it('shows commander evidence explicitly', () => {
    const i = one(build([['Bitterblossom', 6]], ['Purphoros, God of the Forge']), 'tokens');
    const commander = i.evidence.find((e) => e.id === 'commander.engine');
    expect(commander?.value).toBe(true);
  });
});
