import { describe, expect, it } from 'vitest';
import { ratingFor, scoreConsistency, targetedAccessSource } from '@/domain/consistency';
import { analyzeDeckStrategy } from '@/domain/strategy';
import { inferDeckArchetypes } from '@/domain/archetypes';
import { extractDeckPowerEvidence } from '@/domain/powerEvidence';
import type { DeckComposition } from '@/domain/types';
import { basicLand, makeCard } from '../fixtures/cards';
import { realCard } from '../fixtures/roleCards';
import { SYNTHETIC_CONSISTENCY_DECKS } from '../fixtures/consistency/syntheticDecks';

const consistencyOf = (composition: DeckComposition) => {
  const strategy = analyzeDeckStrategy(composition);
  const archetypes = inferDeckArchetypes(composition, strategy);
  const evidence = extractDeckPowerEvidence(composition, strategy, archetypes);
  return scoreConsistency(composition, evidence, archetypes);
};

const synthetic = (id: string) => {
  const deck = SYNTHETIC_CONSISTENCY_DECKS.find((d) => d.id === id);
  if (!deck) throw new Error(`no synthetic deck ${id}`);
  return consistencyOf(deck.composition);
};

const land = (n: number) => ({ card: basicLand('Forest', 'G'), quantity: n });
const one = (name: string) => ({ card: realCard(name), quantity: 1 });
const filler = (n: number) => ({
  card: makeCard({ name: 'Filler', typeLine: 'Creature — Human', cmc: 3, manaCost: '{2}{G}', oracleText: '' }),
  quantity: n,
});

describe('rating bands', () => {
  it.each([
    [0, 'low'], [24, 'low'], [25, 'moderate'], [44, 'moderate'],
    [45, 'good'], [64, 'good'], [65, 'high'], [79, 'high'],
    [80, 'elite'], [100, 'elite'],
  ] as const)('%i is %s', (score, expected) => expect(ratingFor(score)).toBe(expected));
});

describe('shape', () => {
  it('bounds the total and every component by its own maximum', () => {
    for (const deck of SYNTHETIC_CONSISTENCY_DECKS) {
      const c = consistencyOf(deck.composition);
      expect(c.score, deck.id).toBeGreaterThanOrEqual(0);
      expect(c.score, deck.id).toBeLessThanOrEqual(100);
      for (const [name, comp] of [
        ['targetedAccess', c.targetedAccess],
        ['selection', c.selection],
        ['cardFlow', c.cardFlow],
        ['redundancy', c.redundancy],
        ['commanderAccess', c.commanderAccess],
      ] as const) {
        expect(comp.score, `${deck.id}/${name}`).toBeGreaterThanOrEqual(0);
        expect(comp.score, `${deck.id}/${name}`).toBeLessThanOrEqual(comp.max);
      }
    }
  });

  it('sums the five components into the total', () => {
    for (const deck of SYNTHETIC_CONSISTENCY_DECKS) {
      const c = consistencyOf(deck.composition);
      const sum =
        c.targetedAccess.score + c.selection.score + c.cardFlow.score +
        c.redundancy.score + c.commanderAccess.score;
      expect(Math.abs(sum - c.score), deck.id).toBeLessThan(0.05);
    }
  });

  it('makes no claim about turns, wins, or mana quality', () => {
    const json = JSON.stringify(synthetic('tokens-with-doubling'));
    expect(json).not.toMatch(/turn|winsOn|manaQuality|colorScrew/i);
  });
});

describe('optional functions never penalise', () => {
  /*
   * The load-bearing semantic test. Optional functions are a capped bonus on
   * the required base rather than members of the mean, so neither LISTING an
   * optional in the archetype definition nor OWNING a single weak copy of it
   * may lower the score.
   */
  it('leaves an absent optional completely inert', () => {
    const without = synthetic('tokens-without-doubling');
    const absent = without.redundancy.functions.find((f) => f.id === 'token_doubling');
    expect(absent).toBeDefined();
    expect(absent!.support).toBe(0);
    expect(without.redundancy.optionalBonus).toBe(0);
    expect(without.redundancy.optionalCoverage).toBe(0);
  });

  it('does not lower the score for owning exactly one weak optional card', () => {
    const without = synthetic('tokens-without-doubling');
    const weak = synthetic('tokens-single-weak-optional');
    expect(weak.redundancy.score).toBeGreaterThanOrEqual(without.redundancy.score);
  });

  it('rewards a well-supported optional', () => {
    const without = synthetic('tokens-without-doubling');
    const withDoubling = synthetic('tokens-with-doubling');
    expect(withDoubling.redundancy.score).toBeGreaterThan(without.redundancy.score);
    expect(withDoubling.redundancy.optionalBonus).toBeGreaterThan(0);
  });

  it('caps the optional bonus so optionals alone cannot max the component', () => {
    for (const deck of SYNTHETIC_CONSISTENCY_DECKS) {
      const r = consistencyOf(deck.composition).redundancy;
      expect(r.optionalBonus, deck.id).toBeLessThanOrEqual(3);
      expect(r.score, deck.id).toBeLessThanOrEqual(r.max);
    }
  });

  it('values an optional independently of how strong the required base is', () => {
    /*
     * The reason the bonus is additive: under a multiplier the same optional
     * card is worth several times more to an already-saturated deck than to a
     * thin one. Here two decks with identical optional support receive an
     * identical bonus regardless of their required depth.
     */
    const weakReq = consistencyOf({
      commanders: [],
      mainboard: [
        one('Bitterblossom'), one('Cryptbreaker'), one('Academy Manufactor'),
        one('Dockside Extortionist'), one('Goldspan Dragon'), one('Impact Tremors'),
        one('Anointed Procession'), one('Parallel Lives'), one('Doubling Season'),
        filler(54), land(37),
      ],
    }).redundancy;
    const strongReq = synthetic('tokens-with-doubling').redundancy;
    expect(strongReq.raw.base).not.toBe(weakReq.raw.base);
    expect(weakReq.optionalBonus).toBeCloseTo(strongReq.optionalBonus, 2);
  });

  it('rewards breadth of optionals, not just depth of one', () => {
    /*
     * optionalCoverage is what a mean over actives alone cannot see. Needs an
     * archetype defining several optionals: Tokens defines exactly one, so its
     * coverage is 1.0 whether it runs one doubler or three.
     */
    const tokens = synthetic('tokens-with-doubling').redundancy;
    expect(tokens.raw.totalOptional).toBe(1);
    expect(tokens.optionalCoverage).toBe(1);

    // Spellslinger defines three optionals; the commander pair activates one.
    const narrow = synthetic('commander-engine-with-redundancy').redundancy;
    expect(Number(narrow.raw.totalOptional)).toBeGreaterThan(1);
    expect(narrow.optionalCoverage).toBeLessThan(1);
    expect(narrow.optionalBonus).toBeLessThan(3);
  });
});

describe('required coverage', () => {
  it('does not penalise Equipment Voltron for running zero Auras', () => {
    /*
     * The reason `aura` is optional under `voltron`: an Equipment build is a
     * legitimate, complete deck. It must reach full required coverage.
     */
    const c = synthetic('aura-voltron-no-aura');
    expect(c.redundancy.raw.primaryArchetype).toBe('voltron');
    expect(c.redundancy.requiredCoverage).toBe(1);
    expect(c.redundancy.completenessMultiplier).toBe(1);
    const aura = c.redundancy.functions.find((f) => f.id === 'aura');
    expect(aura?.kind).toBe('optional');
  });

  it('applies the completeness floor when a required function is missing', () => {
    // Tokens requires token_generation AND token_payoff; supply only the first.
    const c = consistencyOf({
      commanders: [],
      mainboard: [
        one('Bitterblossom'), one('Cryptbreaker'), one('Academy Manufactor'),
        one('Dockside Extortionist'), one('Goldspan Dragon'), one('Bloodforged Battle-Axe'),
        filler(57), land(37),
      ],
    });
    expect(c.redundancy.raw.primaryArchetype).toBe('tokens');
    expect(c.redundancy.requiredCoverage).toBe(0.5);
    expect(c.redundancy.completenessMultiplier).toBe(0.75);
  });

  it('does not treat a missing OPTIONAL as missing coverage', () => {
    const c = synthetic('tokens-without-doubling');
    expect(c.redundancy.requiredCoverage).toBe(1);
    expect(c.redundancy.completenessMultiplier).toBe(1);
  });

  it('scores zero redundancy when no archetype anchors', () => {
    const c = consistencyOf({ commanders: [], mainboard: [filler(63), land(37)] });
    expect(c.redundancy.score).toBe(0);
    expect(c.redundancy.functions).toEqual([]);
    expect(c.limitations.join(' ')).toMatch(/no primary archetype/);
  });
});

describe('alternative groups', () => {
  it('scores an OR group as one requirement, deduplicating shared cards', () => {
    const c = synthetic('low-tutors-high-redundancy');
    for (const f of c.redundancy.functions) {
      if (f.tags.length < 2) continue;
      const summed = Object.values(f.perTag).reduce((a, b) => a + b, 0);
      // dedup means the group can never exceed the naive per-tag sum
      expect(f.support).toBeLessThanOrEqual(summed);
    }
  });
});

describe('targeted access', () => {
  it('gives no credit for tutors that find nothing relevant', () => {
    // Mystical Tutor finds instants/sorceries; this deck's plan is creatures.
    const c = consistencyOf({
      commanders: [],
      mainboard: [one('Mystical Tutor'), filler(62), land(37)],
    });
    expect(c.targetedAccess.score).toBe(0);
  });

  describe('provenance', () => {
    it.each([
      [10, 4, 'general'],
      [4, 10, 'combo'],
      [10, 10, 'both'],
      [0, 0, 'none'],
    ] as const)('general=%i combo=%i is %s', (g, c, expected) =>
      expect(targetedAccessSource(g, c)).toBe(expected));

    it('reports "none" rather than a tie when neither path scores', () => {
      // 0 === 0 is a tie numerically, but attributing it to "both" would imply
      // two working access paths where there are none.
      const c = synthetic('combo-no-tutor');
      expect(c.targetedAccess.score).toBe(0);
      expect(c.targetedAccess.raw.source).toBe('none');
    });

    it('reports "both" when a tutor serves the general and combo paths alike', () => {
      const c = synthetic('combo-relevant-tutor');
      expect(Number(c.targetedAccess.raw.generalAccess))
        .toBeCloseTo(Number(c.targetedAccess.raw.comboAccess), 2);
      expect(c.targetedAccess.raw.source).toBe('both');
    });

    it('reports "general" when only non-combo access exists', () => {
      const c = synthetic('high-tutors-low-redundancy');
      expect(Number(c.targetedAccess.raw.comboAccess)).toBe(0);
      expect(c.targetedAccess.raw.source).toBe('general');
    });

    it('never lets provenance change the score', () => {
      for (const deck of SYNTHETIC_CONSISTENCY_DECKS) {
        const a = consistencyOf(deck.composition).targetedAccess;
        expect(a.score, deck.id).toBeCloseTo(
          Math.max(Number(a.raw.generalAccess), Number(a.raw.comboAccess)),
          2,
        );
      }
    });
  });

  it('separates general and combo access and folds them with max, never a sum', () => {
    const c = synthetic('high-tutors-low-redundancy');
    const general = Number(c.targetedAccess.raw.generalAccess);
    const combo = Number(c.targetedAccess.raw.comboAccess);
    expect(c.targetedAccess.score).toBeCloseTo(Math.max(general, combo), 2);
    expect(c.targetedAccess.score).toBeLessThanOrEqual(general + combo);
  });

  it('rewards a tutor-dense deck over an otherwise identical tutorless one', () => {
    const tutors = synthetic('high-tutors-low-redundancy');
    const none = synthetic('low-tutors-high-redundancy');
    expect(tutors.targetedAccess.score).toBeGreaterThan(none.targetedAccess.score);
    expect(none.targetedAccess.score).toBe(0);
  });
});

describe('tutors versus redundancy', () => {
  it('scores access and reproducibility as independent components', () => {
    const tutors = synthetic('high-tutors-low-redundancy');
    const redundant = synthetic('low-tutors-high-redundancy');
    expect(tutors.targetedAccess.score).toBeGreaterThan(redundant.targetedAccess.score);
    expect(redundant.redundancy.score).toBeGreaterThan(tutors.redundancy.score);
  });
});

describe('commander access', () => {
  it('credits a commander that supplies the primary engine', () => {
    const c = synthetic('commander-engine-no-redundancy');
    expect(c.commanderAccess.score).toBe(c.commanderAccess.max);
    expect(c.commanderAccess.raw.commanderProvidesPrimaryEngine).toBe(true);
  });

  it('does not reduce commander access when the mainboard also has the function', () => {
    const bare = synthetic('commander-engine-no-redundancy');
    const backed = synthetic('commander-engine-with-redundancy');
    // Commander access is about reliable access, not dependence; punishing
    // reliance belongs to Resilience.
    expect(backed.commanderAccess.score).toBe(bare.commanderAccess.score);
    expect(backed.redundancy.score).toBeGreaterThan(bare.redundancy.score);
  });

  it('gives no commander credit when there is no commander', () => {
    const c = synthetic('tokens-with-doubling');
    expect(c.commanderAccess.score).toBe(0);
  });
});

describe('card flow', () => {
  it('counts a single physical card once across overlapping buckets', () => {
    const c = consistencyOf({
      commanders: [],
      mainboard: [one('Rhystic Study'), filler(62), land(37)],
    });
    const raw = c.cardFlow.raw;
    expect(Number(raw.efficientOnly) + Number(raw.repeatableOnly) + Number(raw.plainOnly) + Number(raw.efficientAndRepeatable))
      .toBeLessThanOrEqual(Number(raw.total));
  });

  it('never produces a negative bucket', () => {
    for (const deck of SYNTHETIC_CONSISTENCY_DECKS) {
      const raw = consistencyOf(deck.composition).cardFlow.raw;
      for (const key of ['efficientOnly', 'repeatableOnly', 'plainOnly'] as const) {
        expect(Number(raw[key]), `${deck.id}/${key}`).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('limitations', () => {
  it('always discloses that mana reliability is out of scope', () => {
    const c = synthetic('tokens-with-doubling');
    expect(c.limitations.join(' ')).toMatch(/mana reliability/i);
  });
});
