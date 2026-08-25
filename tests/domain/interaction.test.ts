import { describe, expect, it } from 'vitest';
import { ratingFor, scoreInteraction } from '@/domain/interaction';
import { analyzeDeckStrategy } from '@/domain/strategy';
import { inferDeckArchetypes } from '@/domain/archetypes';
import { extractDeckPowerEvidence } from '@/domain/powerEvidence';
import type { DeckComposition } from '@/domain/types';
import { basicLand, makeCard } from '../fixtures/cards';
import { realCard } from '../fixtures/roleCards';
import { SYNTHETIC_INTERACTION_DECKS } from '../fixtures/interaction/syntheticDecks';

const interactionOf = (composition: DeckComposition) => {
  const strategy = analyzeDeckStrategy(composition);
  const archetypes = inferDeckArchetypes(composition, strategy);
  const evidence = extractDeckPowerEvidence(composition, strategy, archetypes);
  return scoreInteraction(composition, evidence);
};

const synthetic = (id: string) => {
  const deck = SYNTHETIC_INTERACTION_DECKS.find((d) => d.id === id);
  if (!deck) throw new Error(`no synthetic deck ${id}`);
  return interactionOf(deck.composition);
};

const land = (n: number) => ({ card: basicLand('Forest', 'G'), quantity: n });
const one = (name: string) => ({ card: realCard(name), quantity: 1 });
const filler = (n: number) => ({
  card: makeCard({ name: 'Filler', typeLine: 'Creature — Human', cmc: 3, manaCost: '{2}{G}', oracleText: '' }),
  quantity: n,
});
const deckOf = (cards: string[], pad = 60): DeckComposition => ({
  commanders: [],
  mainboard: [...cards.map(one), filler(pad), land(37)],
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
    for (const deck of SYNTHETIC_INTERACTION_DECKS) {
      const i = interactionOf(deck.composition);
      expect(i.score, deck.id).toBeGreaterThanOrEqual(0);
      expect(i.score, deck.id).toBeLessThanOrEqual(100);
      for (const [name, c] of [
        ['availability', i.availability], ['efficiency', i.efficiency],
        ['coverage', i.coverage], ['stack', i.stack], ['stax', i.stax],
        ['graveyard', i.graveyard], ['boardReset', i.boardReset],
      ] as const) {
        expect(c.score, `${deck.id}/${name}`).toBeGreaterThanOrEqual(0);
        expect(c.score, `${deck.id}/${name}`).toBeLessThanOrEqual(c.max);
      }
    }
  });

  it('sums the seven components into the total', () => {
    for (const deck of SYNTHETIC_INTERACTION_DECKS) {
      const i = interactionOf(deck.composition);
      const sum = i.availability.score + i.efficiency.score + i.coverage.score +
        i.stack.score + i.stax.score + i.graveyard.score + i.boardReset.score;
      expect(Math.abs(sum - i.score), deck.id).toBeLessThan(0.05);
    }
  });

  it('component maxima total exactly 100', () => {
    const i = synthetic('balanced-suite');
    const total = i.availability.max + i.efficiency.max + i.coverage.max +
      i.stack.max + i.stax.max + i.graveyard.max + i.boardReset.max;
    expect(total).toBe(100);
  });

  it('scores an empty deck at zero', () => {
    const i = interactionOf({ commanders: [], mainboard: [filler(62), land(37)] });
    expect(i.score).toBe(0);
    expect(i.rating).toBe('low');
  });
});

describe('availability uses disjoint physical buckets', () => {
  /*
   * Phase 4A's boardWipeCount counts wipes with or without the interaction
   * role, while targetedInteractionCount excludes them, so those fields
   * overlap. Availability must bucket physical cards itself.
   */
  it('counts each physical card exactly once', () => {
    for (const deck of SYNTHETIC_INTERACTION_DECKS) {
      const raw = interactionOf(deck.composition).availability.raw;
      const sum = Number(raw.targetedNonWipe) + Number(raw.wipe) + Number(raw.gyHateOnly);
      expect(sum, deck.id).toBe(Number(raw.physicalCards));
    }
  });

  it('does not let a graveyard-hate wipe be counted twice', () => {
    // Farewell is both board_wipe and graveyard_hate.
    const raw = interactionOf(deckOf(['Farewell'])).availability.raw;
    expect(Number(raw.wipe)).toBe(1);
    expect(Number(raw.gyHateOnly)).toBe(0);
    expect(Number(raw.physicalCards)).toBe(1);
  });

  it('weights a wipe below targeted interaction and graveyard hate below both', () => {
    const targeted = interactionOf(deckOf(['Swords to Plowshares'])).availability.score;
    const wipe = interactionOf(deckOf(['Damnation'])).availability.score;
    const gy = interactionOf(deckOf(['Bojuka Bog'])).availability.score;
    expect(targeted).toBeGreaterThan(wipe);
    expect(wipe).toBeGreaterThan(gy);
  });

  it('normalises against actual composition size, not a hardcoded 99', () => {
    const small = interactionOf({
      commanders: [],
      mainboard: [one('Swords to Plowshares'), one('Counterspell'), filler(8), land(10)],
    });
    const full = interactionOf(deckOf(['Swords to Plowshares', 'Counterspell']));
    expect(Number(small.availability.raw.deckSize)).toBe(20);
    expect(Number(full.availability.raw.deckSize)).toBe(99);
    // Same physical answers in a much smaller deck are denser, so score higher.
    expect(small.availability.score).toBeGreaterThan(full.availability.score);
  });
});

describe('efficiency blends one card into one bucket', () => {
  it('places a free answer in the free bucket only', () => {
    const raw = interactionOf(deckOf(['Force of Will'])).efficiency.raw;
    expect(raw.free).toBe(1);
    expect(raw.efficientNonFree).toBe(0);
    expect(raw.generic).toBe(0);
  });

  it('places an efficient non-free answer in the efficient bucket only', () => {
    const raw = interactionOf(deckOf(['Swords to Plowshares'])).efficiency.raw;
    expect(raw.free).toBe(0);
    expect(raw.efficientNonFree).toBe(1);
    expect(raw.generic).toBe(0);
  });

  it('places an ordinary answer in the generic bucket only', () => {
    const raw = interactionOf(deckOf(['Beast Within'])).efficiency.raw;
    expect(raw.free).toBe(0);
    expect(raw.efficientNonFree).toBe(0);
    expect(raw.generic).toBe(1);
  });

  it('reduces generic credit for a card admitted only as a wipe', () => {
    // Toxic Deluge is board_wipe with no interaction role.
    const wipeOnly = interactionOf(deckOf(['Toxic Deluge'])).efficiency;
    const ordinary = interactionOf(deckOf(['Beast Within'])).efficiency;
    expect(wipeOnly.raw.specialistOnly).toBe(1);
    expect(ordinary.raw.specialistOnly).toBe(0);
    expect(Number(wipeOnly.raw.weightedPool)).toBeCloseTo(
      Number(ordinary.raw.weightedPool) * 0.6, 4);
  });

  it('reduces generic credit further for a card admitted only as graveyard hate', () => {
    const gyOnly = interactionOf(deckOf(['Bojuka Bog'])).efficiency;
    const ordinary = interactionOf(deckOf(['Beast Within'])).efficiency;
    expect(gyOnly.raw.specialistOnly).toBe(1);
    expect(Number(gyOnly.raw.weightedPool)).toBeCloseTo(
      Number(ordinary.raw.weightedPool) * 0.4, 4);
  });

  it('keeps FULL credit for a wipe that is also ordinary interaction', () => {
    /*
     * The rule discounts a card only when the specialist property is the sole
     * reason it entered the pool. Cyclonic Rift is interaction that also
     * sweeps, so it must not be penalised.
     */
    const rift = interactionOf(deckOf(['Cyclonic Rift'])).efficiency;
    const ordinary = interactionOf(deckOf(['Beast Within'])).efficiency;
    expect(rift.raw.specialistOnly).toBe(0);
    expect(Number(rift.raw.weightedPool)).toBeCloseTo(Number(ordinary.raw.weightedPool), 4);
  });

  it('leaves a purely generic efficient suite untouched', () => {
    const i = interactionOf(deckOf(['Swords to Plowshares', 'Path to Exile', 'Pongify']));
    expect(i.efficiency.raw.specialistOnly).toBe(0);
    // 3 efficient non-free cards at full weight.
    expect(Number(i.efficiency.raw.weightedPool)).toBeCloseTo(3 * 1.8, 4);
  });

  it('still gives specialists real, non-zero generic credit', () => {
    // Reduced credit, not zero credit.
    const gy = interactionOf(deckOf(['Bojuka Bog'])).efficiency;
    expect(gy.score).toBeGreaterThan(0);
  });

  it('ranks free above efficient above generic', () => {
    const free = interactionOf(deckOf(['Force of Will'])).efficiency.score;
    const eff = interactionOf(deckOf(['Swords to Plowshares'])).efficiency.score;
    const gen = interactionOf(deckOf(['Beast Within'])).efficiency.score;
    expect(free).toBeGreaterThan(eff);
    expect(eff).toBeGreaterThan(gen);
  });
});

describe('coverage rewards breadth, not repetition', () => {
  it('scores a category once no matter how many answers hit it', () => {
    const one1 = interactionOf(deckOf(['Swords to Plowshares'])).coverage.score;
    const many = interactionOf(
      deckOf(['Swords to Plowshares', 'Path to Exile', 'Pongify', 'Rapid Hybridization']),
    ).coverage.score;
    expect(many).toBe(one1);
  });

  it('excludes graveyard, whose Phase 4A coverage field is structurally dead', () => {
    const c = interactionOf(deckOf(['Bojuka Bog', 'Rest in Peace'])).coverage;
    expect(c.categories.map((x) => x.category)).not.toContain('graveyard');
    expect(c.score).toBe(0);
  });

  it('weights planeswalker and land far below creature and spell', () => {
    const cats = synthetic('balanced-suite').coverage.categories;
    const w = (name: string) => cats.find((c) => c.category === name)!.weight;
    expect(w('creature')).toBe(0.25);
    expect(w('spell')).toBe(0.25);
    expect(w('planeswalker')).toBe(0.05);
    expect(w('land')).toBe(0.05);
  });

  it('reaches full breadth only across all six categories', () => {
    const cats = synthetic('balanced-suite').coverage.categories;
    expect(cats.reduce((s, c) => s + c.weight, 0)).toBeCloseTo(1, 6);
  });
});

describe('stack capability', () => {
  it('gives zero when the deck has no counterspells', () => {
    const s = synthetic('no-stack-broad-permanent').stack;
    expect(s.raw.counterspells).toBe(0);
    expect(s.score).toBe(0);
  });

  it('applies a presence bonus for the first counterspell', () => {
    const s = interactionOf(deckOf(['Counterspell'])).stack;
    expect(s.raw.presence).toBe(4);
    expect(s.score).toBeGreaterThan(4);
  });

  it('ranks free counterspells above efficient above generic', () => {
    const free = interactionOf(deckOf(['Force of Will'])).stack.score;
    const eff = interactionOf(deckOf(['Counterspell'])).stack.score;
    const gen = interactionOf(deckOf(['Withering Boon'])).stack.score;
    expect(free).toBeGreaterThan(eff);
    expect(eff).toBeGreaterThan(gen);
  });

  it('does not make a deck without counterspells unable to score well', () => {
    // Stack access is a strength, not a universal requirement.
    const i = synthetic('no-stack-broad-permanent');
    expect(i.stack.score).toBe(0);
    expect(i.score).toBeGreaterThanOrEqual(45);
  });
});

describe('stax', () => {
  it('rewards breadth of restriction categories and some density', () => {
    const s = synthetic('stax-heavy-little-interaction').stax;
    expect(Number(s.raw.staxCount)).toBeGreaterThan(0);
    expect(Number(s.raw.activeRestrictionCategories)).toBeGreaterThan(0);
    expect(s.score).toBeGreaterThan(0);
  });

  it('stays modest, so stax alone cannot approach elite', () => {
    const i = synthetic('stax-heavy-little-interaction');
    expect(i.stax.score).toBeLessThanOrEqual(10);
    expect(i.score).toBeLessThan(65);
  });

  it('discloses that asymmetry is not modelled', () => {
    const i = synthetic('stax-heavy-little-interaction');
    expect(i.limitations.join(' ')).toMatch(/asymmetry is not modelled/);
  });
});

describe('board reset uses strong diminishing returns', () => {
  it('gives nothing without a wipe', () => {
    expect(interactionOf(deckOf(['Swords to Plowshares'])).boardReset.score).toBe(0);
  });

  it('does not let eight wipes score near twice four', () => {
    const four = interactionOf(deckOf(['Damnation', 'Blasphemous Act', 'Cleansing Nova', 'Fumigate'])).boardReset.score;
    const eight = synthetic('board-wipe-heavy').boardReset.score;
    expect(eight).toBeLessThan(four * 1.25);
  });

  it('caps reset so wipes cannot replace targeted interaction', () => {
    const wipes = synthetic('board-wipe-heavy');
    const targeted = synthetic('efficient-targeted-few-wipes');
    expect(wipes.boardReset.score).toBeLessThanOrEqual(5);
    expect(targeted.score).toBeGreaterThan(wipes.score);
  });
});

describe('graveyard capability', () => {
  it('derives from graveyardHateCount, not the dead coverage field', () => {
    const g = interactionOf(deckOf(['Bojuka Bog', 'Rest in Peace'])).graveyard;
    expect(g.raw.graveyardHateCount).toBe(2);
    expect(g.score).toBeGreaterThan(0);
  });

  it('stays specialised: graveyard alone cannot carry the dimension', () => {
    const i = synthetic('graveyard-hate-heavy');
    expect(i.graveyard.score).toBeLessThanOrEqual(5);
    expect(i.score).toBeLessThan(45);
  });
});

describe('relational expectations', () => {
  it('A > B: same breadth, better efficiency wins', () => {
    expect(synthetic('high-interaction-high-efficiency').score)
      .toBeGreaterThan(synthetic('high-interaction-low-efficiency').score);
  });

  it('D >= C: broad eight beats narrow twelve', () => {
    expect(synthetic('broad-low-count').score)
      .toBeGreaterThanOrEqual(synthetic('creature-removal-only').score);
  });

  it('F > E: efficient targeted beats wipe-heavy', () => {
    expect(synthetic('efficient-targeted-few-wipes').score)
      .toBeGreaterThan(synthetic('board-wipe-heavy').score);
  });

  it('modal and independent answers have equal physical density', () => {
    const modal = synthetic('modal-three-flexible');
    const narrow = synthetic('independent-three-narrow');
    expect(modal.availability.raw.physicalCards).toBe(narrow.availability.raw.physicalCards);
    expect(modal.availability.score).toBeCloseTo(narrow.availability.score, 2);
  });

  it('modal answers cover more categories than the same number of narrow ones', () => {
    expect(synthetic('modal-three-flexible').coverage.score)
      .toBeGreaterThan(synthetic('independent-three-narrow').coverage.score);
  });
});

describe('limitations', () => {
  it('always discloses the missing instant-speed flag and commander gap', () => {
    const l = synthetic('balanced-suite').limitations.join(' ');
    expect(l).toMatch(/instant-speed/i);
    expect(l).toMatch(/commander-supplied interaction is not measured/i);
  });

  it('always discloses the frozen model characteristics, deck-independently', () => {
    /*
     * These describe the model, not the deck, so they must appear even for a
     * deck with no interaction at all.
     */
    const bare = interactionOf({ commanders: [], mainboard: [filler(62), land(37)] });
    const l = bare.limitations.join(' ');
    expect(l).toMatch(/0-to-1 discontinuity/i);
    expect(l).toMatch(/capability checklist/i);
    expect(l).toMatch(/instant-speed/i);
    expect(l).toMatch(/commander-supplied interaction is not measured/i);
  });

  it('flags modal coverage inflation when modal answers are present', () => {
    expect(synthetic('modal-three-flexible').limitations.join(' '))
      .toMatch(/modal permanent answer/i);
  });
});
