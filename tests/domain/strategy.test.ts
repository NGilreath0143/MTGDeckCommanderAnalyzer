import { describe, expect, it } from 'vitest';
import {
  analyzeDeckStrategy,
  commanderScoreFor,
  coverageScoreFor,
  relationshipScoreFor,
  strengthFor,
} from '@/domain/strategy';
import {
  STRATEGY_SIGNAL_TYPES,
  type CardTag,
  type DeckComposition,
  type ResolvedCard,
  type StrategySignal,
  type StrategySignalType,
} from '@/domain/types';
import { basicLand, makeCard } from '../fixtures/cards';
import { realCard } from '../fixtures/roleCards';

/** Semantic specification for deck-level strategy signals. */

const signal = (
  composition: DeckComposition,
  strategy: StrategySignalType,
): StrategySignal => {
  const s = analyzeDeckStrategy(composition).signals.find((x) => x.strategy === strategy);
  if (!s) throw new Error(`no signal for ${strategy}`);
  return s;
};

/** Build a composition from named real cards, padding with basics. */
function deck(
  mainboardNames: string[],
  commanderNames: string[] = [],
  pad = 0,
): DeckComposition {
  const mainboard = mainboardNames.map((n) => ({ card: realCard(n), quantity: 1 }));
  if (pad > 0) mainboard.push({ card: basicLand('Forest', 'G'), quantity: pad });
  return { commanders: commanderNames.map(realCard), mainboard };
}

const rel = (s: StrategySignal, id: string) => {
  const r = s.structure.relationships.find((x) => x.id === id);
  if (!r) throw new Error(`no relationship ${id}`);
  return r;
};

// ---------------------------------------------------------------------------
// Formulas
// ---------------------------------------------------------------------------

describe('coverage formula', () => {
  it.each([
    [0, 0],
    [3, 8.8],
    [5, 13.6],
    [10, 22.6],
    [15, 28.5],
    [20, 32.4],
    [25, 35.0],
    [30, 36.7],
    [40, 38.6],
  ])('%i participating cards scores about %f', (cards, expected) => {
    expect(coverageScoreFor(cards)).toBeCloseTo(expected, 0);
  });

  it('is bounded to 40 and never negative', () => {
    expect(coverageScoreFor(0)).toBe(0);
    expect(coverageScoreFor(1000)).toBeLessThanOrEqual(40);
    expect(coverageScoreFor(1000)).toBeGreaterThan(39.9);
  });

  it('has diminishing returns', () => {
    const first = coverageScoreFor(5) - coverageScoreFor(0);
    const later = coverageScoreFor(35) - coverageScoreFor(30);
    expect(first).toBeGreaterThan(later);
  });
});

describe('relationship formula', () => {
  it('scores 0 with no support', () => expect(relationshipScoreFor(0, 18)).toBe(0));

  it('approaches but never exceeds its maximum', () => {
    expect(relationshipScoreFor(4, 18)).toBeCloseTo(11.38, 1);
    expect(relationshipScoreFor(100, 18)).toBeLessThanOrEqual(18);
  });

  it('respects differing maxima', () => {
    expect(relationshipScoreFor(4, 10)).toBeLessThan(relationshipScoreFor(4, 18));
  });
});

describe('strength labels', () => {
  it.each([
    [0, 'negligible'],
    [14, 'negligible'],
    [15, 'minor'],
    [29, 'minor'],
    [30, 'supporting'],
    [49, 'supporting'],
    [50, 'strong'],
    [69, 'strong'],
    [70, 'defining'],
    [100, 'defining'],
  ])('%i is %s', (score, expected) => expect(strengthFor(score)).toBe(expected));
});

describe('commander alignment', () => {
  it.each([
    [0, 0],
    [1, 8],
    [2, 15],
    [3, 15],
  ])('%i distinct commander tags scores %i', (tags, expected) => {
    expect(commanderScoreFor(tags)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Coverage behaviour
// ---------------------------------------------------------------------------

describe('coverage counting', () => {
  it('excludes commanders from coverage', () => {
    const withCommander = signal(deck([], ['Tatyova, Benthic Druid']), 'lands');
    expect(withCommander.coverage.participatingCards).toBe(0);
    // But the commander still drives alignment and diversity.
    expect(withCommander.commanderScore).toBe(8);
    expect(withCommander.diversityScore).toBeGreaterThan(0);
  });

  it('respects quantities as multiple participating slots', () => {
    const one = { commanders: [], mainboard: [{ card: realCard('Lotus Cobra'), quantity: 1 }] };
    const four = { commanders: [], mainboard: [{ card: realCard('Lotus Cobra'), quantity: 4 }] };
    expect(signal(one, 'lands').coverage.participatingCards).toBe(1);
    expect(signal(four, 'lands').coverage.participatingCards).toBe(4);
  });

  it('counts a multi-tag card once', () => {
    // Walking Ballista carries three counter tags.
    const s = signal(deck(['Walking Ballista']), 'counters');
    expect(s.coverage.participatingCards).toBe(1);
    expect(s.representedTags.length).toBeGreaterThan(1);
  });

  it('uses the actual composition size, not an assumed 99', () => {
    const s = signal(deck(['Lotus Cobra'], [], 9), 'lands');
    expect(s.coverage.mainboardSize).toBe(10);
    expect(s.coverage.density).toBeCloseTo(0.1, 2);
  });

  it('reports zero density for an empty mainboard without dividing by zero', () => {
    const s = signal({ commanders: [], mainboard: [] }, 'lands');
    expect(s.coverage.density).toBe(0);
    expect(Number.isFinite(s.score)).toBe(true);
  });
});

describe('planeswalker type evidence', () => {
  const jace = makeCard({
    name: 'Jace, the Mind Sculptor',
    typeLine: 'Legendary Planeswalker — Jace',
    oracleText: '+2: Look at the top card of target player\'s library.',
  });

  it('counts an untagged planeswalker as coverage', () => {
    const s = signal({ commanders: [], mainboard: [{ card: jace, quantity: 1 }] }, 'planeswalkers');
    expect(s.coverage.additionalEvidenceCards).toBe(1);
    expect(s.coverage.participatingCards).toBe(1);
    expect(s.coverage.taggedCards).toBe(0);
  });

  it('does not double-count a planeswalker that also has a relevant tag', () => {
    const taggedPw = makeCard({
      name: 'Tagged Walker',
      typeLine: 'Legendary Planeswalker — Test',
      oracleText: 'For each planeswalker you control, draw a card.',
    });
    const s = signal({ commanders: [], mainboard: [{ card: taggedPw, quantity: 1 }] }, 'planeswalkers');
    expect(s.coverage.taggedCards).toBe(1);
    expect(s.coverage.additionalEvidenceCards).toBe(1);
    expect(s.coverage.participatingCards).toBe(1);
  });

  it('grants no type-based coverage to any other family', () => {
    const composition = {
      commanders: [],
      mainboard: [
        { card: makeCard({ name: 'Plain Artifact', typeLine: 'Artifact', oracleText: '' }), quantity: 1 },
        { card: makeCard({ name: 'Plain Enchantment', typeLine: 'Enchantment', oracleText: '' }), quantity: 1 },
        { card: makeCard({ name: 'Plain Instant', typeLine: 'Instant', oracleText: '' }), quantity: 1 },
        { card: makeCard({ name: 'Plain Creature', typeLine: 'Creature — Bear', oracleText: '' }), quantity: 1 },
        { card: basicLand('Forest', 'G'), quantity: 1 },
      ],
    };
    for (const family of ['artifacts', 'enchantments', 'spells', 'combat', 'lands'] as const) {
      expect(signal(composition, family).coverage.participatingCards, family).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Structure and self-synergy
// ---------------------------------------------------------------------------

describe('structure avoids one-card self-synergy', () => {
  it('gives no relationship score to a lone dual-purpose card', () => {
    // Walking Ballista alone carries both counter_generation and counter_payoff.
    const s = signal(deck(['Walking Ballista']), 'counters');
    const r = rel(s, 'counter_generation+counter_payoff');
    expect(r.rawSupport).toBe(1);
    expect(r.distinctSupport).toBe(0);
    expect(r.score).toBe(0);
  });

  it('scores once a second distinct card supplies a side', () => {
    // Cathars' Crusade is generation-only, so it can partner the dual card.
    const s = signal(deck(['Walking Ballista', "Cathars' Crusade"]), 'counters');
    const r = rel(s, 'counter_generation+counter_payoff');
    expect(r.distinctSupport).toBeGreaterThan(0);
    expect(r.score).toBeGreaterThan(0);
  });

  it('applies the same rule to a commander carrying both sides', () => {
    const dualCommander = makeCard({
      name: 'Dual Commander',
      typeLine: 'Legendary Creature — Test',
      oracleText:
        'Whenever a creature you control enters, put a +1/+1 counter on each creature you control.\n' +
        'Remove a +1/+1 counter from this creature: Draw a card.',
    });
    const s = signal({ commanders: [dualCommander], mainboard: [] }, 'counters');
    expect(rel(s, 'counter_generation+counter_payoff').distinctSupport).toBe(0);
  });

  it('lets commanders contribute to structure alongside a mainboard card', () => {
    // Tatyova (landfall) + Oracle of Mul Daya (land_payoff) in the mainboard.
    const s = signal(deck(['Oracle of Mul Daya'], ['Tatyova, Benthic Druid']), 'lands');
    const r = rel(s, 'landfall+land_payoff');
    expect(r.distinctSupport).toBeGreaterThan(0);
    expect(s.structureScore).toBeGreaterThan(0);
  });

  it('never exceeds a relationship maximum', () => {
    const many = Array.from({ length: 30 }, () => ({
      card: realCard('Bitterblossom'),
      quantity: 1,
    }));
    const composition = {
      commanders: [],
      mainboard: [...many, { card: realCard('Intangible Virtue'), quantity: 20 }],
    };
    const r = rel(signal(composition, 'tokens'), 'token_generation+token_payoff');
    expect(r.score).toBeLessThanOrEqual(r.maxScore);
  });
});

describe('lands consume high ramp only with a lands tag', () => {
  const rampCard = (i: number) =>
    makeCard({ name: `Ramp ${i}`, typeLine: 'Artifact', oracleText: '{T}: Add {C}.' });
  const ramps = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ card: rampCard(i), quantity: 1 }));

  it('awards nothing when no lands tag is present, however much ramp', () => {
    const s = signal({ commanders: [], mainboard: ramps(25) }, 'lands');
    const r = rel(s, 'land_tag+high_ramp');
    expect(r.score).toBe(0);
    expect(s.score).toBe(0);
  });

  it('awards nothing below the 12-piece threshold', () => {
    const composition = {
      commanders: [],
      mainboard: [...ramps(11), { card: realCard('Lotus Cobra'), quantity: 1 }],
    };
    expect(rel(signal(composition, 'lands'), 'land_tag+high_ramp').score).toBe(0);
  });

  it('scales linearly between 12 and 20 ramp pieces', () => {
    // Lotus Cobra supplies the required lands tag AND is itself a ramp piece,
    // so `filler + 1` is the effective ramp count.
    const atRampCount = (total: number) => {
      const composition = {
        commanders: [],
        mainboard: [...ramps(total - 1), { card: realCard('Lotus Cobra'), quantity: 1 }],
      };
      return rel(signal(composition, 'lands'), 'land_tag+high_ramp').score;
    };
    expect(atRampCount(12)).toBeCloseTo(0, 2);
    expect(atRampCount(16)).toBeCloseTo(2, 2);
    expect(atRampCount(20)).toBeCloseTo(4, 2);
    expect(atRampCount(30)).toBeCloseTo(4, 2);
  });
});

describe('combat consumes token_generation for go-wide', () => {
  it('links go_wide_payoff to token generation from another family', () => {
    const s = signal(deck(['Craterhoof Behemoth', 'Bitterblossom']), 'combat');
    const r = rel(s, 'go_wide_payoff+token_generation');
    expect(r.distinctSupport).toBeGreaterThan(0);
    expect(r.score).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Diversity, alignment, caps
// ---------------------------------------------------------------------------

describe('diversity', () => {
  it('is support-weighted, so one incidental card is half-represented', () => {
    // Tokens has 3 tags. A single Bitterblossom gives token_generation 0.5
    // representation -> (0.5 / 3) * 15 = 2.5.
    expect(signal(deck(['Bitterblossom']), 'tokens').diversityScore).toBeCloseTo(2.5, 2);
  });

  it('fully represents a tag once two supporting cards exist', () => {
    const composition = {
      commanders: [],
      mainboard: [{ card: realCard('Bitterblossom'), quantity: 2 }],
    };
    // (1 / 3) * 15 = 5
    expect(signal(composition, 'tokens').diversityScore).toBeCloseTo(5, 2);
  });

  it('does not exceed full representation for a heavily supported tag', () => {
    const composition = {
      commanders: [],
      mainboard: [{ card: realCard('Bitterblossom'), quantity: 40 }],
    };
    expect(signal(composition, 'tokens').diversityScore).toBeCloseTo(5, 2);
  });

  it('cannot reach full diversity from one example of each tag', () => {
    // The whole point of the support weighting: three incidental cards
    // covering three tags must not score 15/15.
    const s = signal(deck(['Bitterblossom', 'Intangible Virtue', 'Parallel Lives']), 'tokens');
    expect(s.representedTags.length).toBe(3);
    expect(s.diversityScore).toBeLessThan(15);
  });

  it('counts a commander tag as one support occurrence', () => {
    // Commander token_payoff (0.5) plus one mainboard token_generation (0.5).
    const s = signal(
      deck(['Bitterblossom'], ['Purphoros, God of the Forge']),
      'tokens',
    );
    expect(s.diversityScore).toBeCloseTo(5, 2);
  });

  it('counts commander tags toward diversity', () => {
    const withoutCommander = signal(deck(['Bitterblossom']), 'tokens').diversityScore;
    const withCommander = signal(
      deck(['Bitterblossom'], ['Purphoros, God of the Forge']),
      'tokens',
    ).diversityScore;
    expect(withCommander).toBeGreaterThanOrEqual(withoutCommander);
  });

  it('is zero for an unrepresented family', () => {
    expect(signal(deck(['Sol Ring']), 'graveyard').diversityScore).toBe(0);
  });
});

describe('commander alignment aggregates collectively', () => {
  it('scores 8 for one distinct relevant tag', () => {
    const s = signal(deck([], ['Tatyova, Benthic Druid']), 'lands');
    expect(s.commanderTags).toEqual(['landfall']);
    expect(s.commanderScore).toBe(8);
  });

  it('does not double the bonus for two commanders sharing a tag', () => {
    const a = realCard('Tatyova, Benthic Druid');
    const b = realCard('Lotus Cobra'); // also landfall
    const s = signal({ commanders: [a, b], mainboard: [] }, 'lands');
    expect(s.commanderTags).toEqual(['landfall']);
    expect(s.commanderScore).toBe(8);
  });

  it('scores 15 when partners collectively bring two distinct tags', () => {
    const s = signal(
      { commanders: [realCard('Tatyova, Benthic Druid'), realCard('Oracle of Mul Daya')], mainboard: [] },
      'lands',
    );
    expect(s.commanderTags.length).toBeGreaterThanOrEqual(2);
    expect(s.commanderScore).toBe(15);
  });

  it('scores 0 when no commander is relevant', () => {
    expect(signal(deck([], ['Sol Ring']), 'lands').commanderScore).toBe(0);
  });
});

describe('single-tag caps', () => {
  const manyOf = (name: string, n: number) => ({
    commanders: [],
    mainboard: [{ card: realCard(name), quantity: n }],
  });

  it('caps a single-tag family at 30 by default', () => {
    // Bitterblossom is token_generation only.
    const s = signal(manyOf('Bitterblossom', 40), 'tokens');
    expect(s.representedTags).toEqual(['token_generation']);
    expect(s.rawScore).toBeGreaterThan(30);
    expect(s.score).toBe(30);
    expect(s.cap).toMatchObject({ applied: true, reason: 'single_tag', maximum: 30 });
  });

  it('caps reanimation-only graveyard at 49', () => {
    const s = signal(manyOf('Reanimate', 40), 'graveyard');
    expect(s.representedTags).toEqual(['reanimation']);
    expect(s.cap.maximum).toBe(49);
    expect(s.score).toBeLessThanOrEqual(49);
  });

  it('caps spell_payoff-only spells at 49', () => {
    const s = signal(manyOf('Young Pyromancer', 40), 'spells');
    expect(s.representedTags).toEqual(['spell_payoff']);
    expect(s.cap.maximum).toBe(49);
  });

  it('does not cap landfall-only lands', () => {
    const s = signal(manyOf('Lotus Cobra', 40), 'lands');
    expect(s.representedTags).toEqual(['landfall']);
    expect(s.cap.applied).toBe(false);
    expect(s.score).toBe(s.rawScore);
  });

  it('caps voltron-only and extra_combat-only combat at 69', () => {
    for (const name of ['Nettlecyst', 'Aurelia, the Warleader']) {
      const s = signal(manyOf(name, 40), 'combat');
      if (s.representedTags.length === 1) expect(s.cap.maximum).toBe(69);
    }
  });

  it('does not cap when the commander supplies a second tag', () => {
    // Mainboard token_generation only; commander adds token_payoff.
    const composition = {
      commanders: [realCard('Purphoros, God of the Forge')],
      mainboard: [{ card: realCard('Bitterblossom'), quantity: 40 }],
    };
    const s = signal(composition, 'tokens');
    expect(s.representedTags.length).toBeGreaterThanOrEqual(2);
    expect(s.cap.applied).toBe(false);
  });

  it('records the cap maximum without applying it below the threshold', () => {
    const s = signal(manyOf('Bitterblossom', 1), 'tokens');
    expect(s.rawScore).toBeLessThan(30);
    expect(s.cap.applied).toBe(false);
    expect(s.score).toBe(s.rawScore);
  });
});

// ---------------------------------------------------------------------------
// Profile shape
// ---------------------------------------------------------------------------

describe('analyzeDeckStrategy output', () => {
  it('returns all ten families in declared order', () => {
    const profile = analyzeDeckStrategy({ commanders: [], mainboard: [] });
    expect(profile.signals.map((s) => s.strategy)).toEqual([...STRATEGY_SIGNAL_TYPES]);
  });

  it('scores an empty deck at zero across the board', () => {
    for (const s of analyzeDeckStrategy({ commanders: [], mainboard: [] }).signals) {
      expect(s.score).toBe(0);
      expect(s.rawScore).toBe(0);
      expect(s.strength).toBe('negligible');
    }
  });

  it('keeps every final score within 0-100', () => {
    const composition: DeckComposition = {
      commanders: [realCard('Atraxa, Praetors\' Voice')],
      mainboard: [
        { card: realCard('Walking Ballista'), quantity: 20 },
        { card: realCard('Hangarback Walker'), quantity: 20 },
        { card: realCard('Doubling Season'), quantity: 20 },
        { card: realCard('Evolution Sage'), quantity: 20 },
      ],
    };
    for (const s of analyzeDeckStrategy(composition).signals) {
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(100);
    }
  });

  it('preserves rawScore separately from the capped score', () => {
    const s = signal(
      { commanders: [], mainboard: [{ card: realCard('Bitterblossom'), quantity: 40 }] },
      'tokens',
    );
    expect(s.rawScore).toBeGreaterThan(s.score);
  });

  it('sums components into rawScore', () => {
    const s = signal(deck(['Walking Ballista', "Cathars' Crusade"]), 'counters');
    const sum = s.coverageScore + s.structureScore + s.diversityScore + s.commanderScore;
    expect(s.rawScore).toBeCloseTo(sum, 1);
  });

  it('exposes per-relationship diagnostics', () => {
    const s = signal(deck(['Walking Ballista', "Cathars' Crusade"]), 'counters');
    expect(s.structure.relationships.length).toBe(5);
    for (const r of s.structure.relationships) {
      expect(r.id).toBeTruthy();
      expect(r.maxScore).toBeGreaterThan(0);
      expect(r.score).toBeLessThanOrEqual(r.maxScore);
      expect(typeof r.rawSupport).toBe('number');
      expect(typeof r.distinctSupport).toBe('number');
    }
  });

  it('is deterministic', () => {
    const composition = deck(
      ['Walking Ballista', 'Doubling Season'],
      ["Atraxa, Praetors' Voice"],
      5,
    );
    expect(JSON.stringify(analyzeDeckStrategy(composition))).toBe(
      JSON.stringify(analyzeDeckStrategy(composition)),
    );
  });
});
