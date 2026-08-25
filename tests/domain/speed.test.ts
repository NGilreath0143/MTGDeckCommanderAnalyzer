import { describe, expect, it } from 'vitest';
import { ratingFor, scoreSpeed } from '@/domain/speed';
import { analyzeDeckStrategy } from '@/domain/strategy';
import { inferDeckArchetypes } from '@/domain/archetypes';
import { extractDeckPowerEvidence } from '@/domain/powerEvidence';
import type { DeckComposition } from '@/domain/types';
import { basicLand, makeCard } from '../fixtures/cards';
import { realCard } from '../fixtures/roleCards';
import { SYNTHETIC_SPEED_DECKS } from '../fixtures/speed/syntheticDecks';

const speedOf = (composition: DeckComposition) => {
  const strategy = analyzeDeckStrategy(composition);
  const archetypes = inferDeckArchetypes(composition, strategy);
  const evidence = extractDeckPowerEvidence(composition, strategy, archetypes);
  return scoreSpeed(composition, evidence, archetypes);
};

const synthetic = (id: string) => {
  const deck = SYNTHETIC_SPEED_DECKS.find((d) => d.id === id);
  if (!deck) throw new Error(`no synthetic deck ${id}`);
  return speedOf(deck.composition);
};

const land = (n: number) => ({ card: basicLand('Forest', 'G'), quantity: n });
const one = (name: string) => ({ card: realCard(name), quantity: 1 });

describe('rating bands', () => {
  it.each([
    [0, 'low'], [24, 'low'], [25, 'moderate'], [44, 'moderate'],
    [45, 'good'], [64, 'good'], [65, 'high'], [79, 'high'],
    [80, 'elite'], [100, 'elite'],
  ])('%i is %s', (score, expected) => expect(ratingFor(score)).toBe(expected));
});

describe('shape', () => {
  it('produces no turn-to-win prediction', () => {
    const json = JSON.stringify(speedOf({ commanders: [], mainboard: [one('Sol Ring'), land(36)] }));
    expect(json).not.toMatch(/turn|winsOn|estimatedTurn/i);
  });

  it('keeps every score within 0-100', () => {
    for (const deck of SYNTHETIC_SPEED_DECKS) {
      const s = speedOf(deck.composition);
      expect(s.score, deck.id).toBeGreaterThanOrEqual(0);
      expect(s.score, deck.id).toBeLessThanOrEqual(100);
      expect(s.development.score, deck.id).toBeGreaterThanOrEqual(0);
      expect(s.winSpeed.score, deck.id).toBeLessThanOrEqual(100);
    }
  });

  it('preserves raw evidence beside every component', () => {
    const s = synthetic('fast-mana-no-win');
    expect(Object.keys(s.development.acceleration.raw)).toContain('fastManaCount');
    expect(Object.keys(s.development.curve.raw)).toContain('averageManaValue');
    expect(Object.keys(s.development.proactiveDevelopment.raw)).toContain('reactiveEarlyPlays');
    expect(Object.keys(s.development.manaBaseFriction.raw)).toContain('effectiveTappedRatio');
  });

  it('is deterministic', () => {
    const deck = SYNTHETIC_SPEED_DECKS[0]!.composition;
    expect(JSON.stringify(speedOf(deck))).toBe(JSON.stringify(speedOf(deck)));
  });
});

describe('development speed', () => {
  it('weights fast mana above ordinary ramp', () => {
    const fast = speedOf({ commanders: [], mainboard: [
      one('Sol Ring'), one('Mana Crypt'), one('Lotus Petal'), land(36),
    ] });
    const ordinary = speedOf({ commanders: [], mainboard: [
      { card: realCard('Cultivate'), quantity: 3 }, land(36),
    ] });
    expect(fast.development.acceleration.score).toBeGreaterThan(
      ordinary.development.acceleration.score,
    );
  });

  it('does not double count a card that is both fast mana and ramp', () => {
    const s = speedOf({ commanders: [], mainboard: [one('Sol Ring'), land(36)] });
    const raw = s.development.acceleration.raw;
    expect(raw.fastRampOverlap).toBe(1);
    // Weighted pool is 2.5 (fast weight), not 3.5 (fast + ramp).
    expect(raw.weightedPool).toBe(2.5);
  });

  it('applies diminishing returns to acceleration', () => {
    const some = speedOf({ commanders: [], mainboard: [
      one('Sol Ring'), one('Mana Crypt'), land(36),
    ] }).development.acceleration.score;
    const lots = synthetic('fast-mana-no-win').development.acceleration.score;
    expect(lots).toBeGreaterThan(some);
    expect(lots).toBeLessThan(45);
  });

  it('separates cheap proactive plays from cheap reactive ones', () => {
    const reactive = synthetic('low-curve-reactive');
    expect(reactive.development.proactiveDevelopment.raw.reactiveEarlyPlays).toBeGreaterThan(
      Number(reactive.development.proactiveDevelopment.raw.proactiveEarlyPlays),
    );
    // A cheap reactive pile must not read as fast development.
    expect(reactive.development.proactiveDevelopment.score).toBeLessThan(10);
  });

  it('gives a low curve points without letting it dominate', () => {
    const s = synthetic('low-curve-reactive');
    expect(s.development.curve.score).toBeGreaterThan(0);
    expect(s.development.curve.score).toBeLessThanOrEqual(25);
  });

  it('creates friction rather than collapse for a high curve', () => {
    const s = synthetic('battlecruiser-high-ramp-high-curve');
    expect(s.development.curve.score).toBeLessThan(10);
    // Ramp still earns real acceleration points.
    expect(s.development.acceleration.score).toBeGreaterThan(15);
  });

  it('reduces development modestly for tapped lands', () => {
    const slow = synthetic('compact-win-low-acceleration');
    expect(slow.development.manaBaseFriction.score).toBeLessThan(0);
    expect(slow.development.manaBaseFriction.score).toBeGreaterThanOrEqual(-12);
  });
});

describe('win speed: combos', () => {
  it('scores a complete 2-card deterministic combo highly', () => {
    const s = synthetic('combo-oracle-consultation');
    expect(s.winSpeed.bestLine?.kind).toBe('combo');
    expect(s.winSpeed.score).toBeGreaterThan(60);
  });

  it('ignores partial combos entirely', () => {
    // Walking Ballista alone is partial known-combo evidence, not a win line.
    const s = speedOf({ commanders: [], mainboard: [one('Walking Ballista'), land(36)] });
    expect(s.winSpeed.lines.some((l) => l.kind === 'combo')).toBe(false);
  });

  it('ranks deterministic wins above resource combos', () => {
    const deterministic = synthetic('combo-oracle-consultation').winSpeed.score;
    const resource = synthetic('combo-resource-no-outlet').winSpeed.score;
    expect(deterministic).toBeGreaterThan(resource);
  });

  it('prefers a smaller combo, all else equal', () => {
    const two = synthetic('combo-oracle-consultation').winSpeed;
    const three = synthetic('combo-three-card').winSpeed;
    expect(two.score).toBeGreaterThan(three.score);
    expect(Number(three.bestLine?.raw.sizeMultiplier)).toBeLessThan(1);
  });

  it('rewards command-zone access', () => {
    const s = synthetic('combo-commander-involved');
    const line = s.winSpeed.lines.find((l) => l.kind === 'combo');
    expect(Number(line?.raw.piecesInCommandZone)).toBe(1);
    expect(Number(line?.raw.commandZoneBonus)).toBeGreaterThan(0);
  });

  it('never treats a printed MV of 0 as free execution', () => {
    const line = synthetic('combo-commander-involved').winSpeed.lines.find(
      (l) => l.kind === 'combo',
    );
    // The mana multiplier only ever penalises; it must not exceed 1.
    expect(Number(line?.raw.manaMultiplier)).toBeLessThanOrEqual(1);
  });

  it('applies setup friction from requirements', () => {
    const line = synthetic('combo-resource-no-outlet').winSpeed.lines.find(
      (l) => l.kind === 'combo',
    );
    expect(Number(line?.raw.setupMultiplier)).toBeLessThan(1);
  });

  it('uses the best line rather than the sum of lines', () => {
    // A deck with both a combo line and an archetype line takes the maximum,
    // never the total: redundant routes are not extra speed.
    const s = synthetic('combat-with-finisher');
    expect(s.winSpeed.lines.length).toBeGreaterThan(0);
    const total = s.winSpeed.lines.reduce((sum, l) => sum + l.score, 0);
    expect(s.winSpeed.score).toBe(Math.max(...s.winSpeed.lines.map((l) => l.score)));
    if (s.winSpeed.lines.length > 1) expect(s.winSpeed.score).toBeLessThan(total);
  });
});

describe('win speed: non-combo archetype lines', () => {
  it('gives a defining archetype meaningful win speed', () => {
    const s = synthetic('combat-with-finisher');
    expect(s.winSpeed.score).toBeGreaterThan(25);
    expect(s.winSpeed.bestLine?.kind).toBe('archetype');
  });

  it('rewards a finisher only when its tags align with the primary strategy', () => {
    // The with-finisher deck has an aligned finisher (Purphoros, token_payoff);
    // the without-finisher deck has no recognised win condition at all.
    const withCard = synthetic('combat-with-finisher');
    const without = synthetic('combat-without-finisher');
    expect(withCard.winSpeed.score).toBeGreaterThan(without.winSpeed.score);

    const line = withCard.winSpeed.lines.find((l) => l.kind === 'archetype');
    expect(String(line?.raw.alignedFinishers)).toContain('Purphoros');
    // Craterhoof is present but its go_wide_payoff tag does not overlap the
    // Tokens support set, so it stays unaligned.
    expect(String(line?.raw.unalignedWinConditions)).toContain('Craterhoof');

    const withoutLine = without.winSpeed.lines.find((l) => l.kind === 'archetype');
    expect(withoutLine?.raw.finisherBonus).toBe(0);
  });

  it('counts only exact tutor matches toward win access', () => {
    const s = synthetic('combat-with-finisher');
    const line = s.winSpeed.lines.find((l) => l.kind === 'archetype');
    expect(line?.raw).toHaveProperty('winTutorAccess');
    expect(Number(line?.raw.winTutorAccess)).toBeLessThanOrEqual(10);
  });

  it('does not credit a tutor for both win and engine access', () => {
    const s = synthetic('combat-with-finisher');
    const line = s.winSpeed.lines.find((l) => l.kind === 'archetype');
    // engineOnlyTutors excludes anything already counted as win-relevant.
    expect(Number(line?.raw.engineTutorAccess)).toBeLessThanOrEqual(4);
  });

  it('gives combo lines tutor access only for tutors that can find a piece', () => {
    const s = synthetic('combo-oracle-consultation');
    const line = s.winSpeed.lines.find((l) => l.kind === 'combo');
    expect(line?.raw).toHaveProperty('comboTutorAccess');
    expect(Number(line?.raw.comboTutorAccess)).toBeLessThanOrEqual(10);
  });

  it('does not treat a card as a finisher merely for being present', () => {
    // Walking Ballista's tags are all counter_*, so it must not read as an
    // Artifacts finisher despite sharing the artifact card type.
    const composition: DeckComposition = {
      commanders: [],
      mainboard: [
        one('Walking Ballista'),
        { card: realCard('Sai, Master Thopterist'), quantity: 4 },
        { card: realCard('Krark-Clan Ironworks'), quantity: 3 },
        land(36),
      ],
    };
    const strategy = analyzeDeckStrategy(composition);
    const archetypes = inferDeckArchetypes(composition, strategy);
    const evidence = extractDeckPowerEvidence(composition, strategy, archetypes);
    const ballista = evidence.winPackage.alignedWinConditions.find(
      (w) => w.name === 'Walking Ballista',
    );
    if (ballista?.archetype === 'artifacts') {
      expect(ballista.aligned).toBe(false);
      expect(ballista.sharedTags).toEqual([]);
    }
  });

  it('keeps archetype lines below a clean compact combo', () => {
    const archetype = synthetic('combat-with-finisher').winSpeed.score;
    const combo = synthetic('combo-oracle-consultation').winSpeed.score;
    expect(archetype).toBeLessThan(combo);
  });

  it('does not award combat closing to Tokens without go-wide evidence', () => {
    const line = synthetic('combat-with-finisher').winSpeed.lines.find(
      (l) => l.kind === 'archetype',
    );
    if (line?.id === 'tokens') expect(Number(line.raw.combatBonus)).toBe(0);
  });

  it('gives zero win speed when nothing is established', () => {
    const s = speedOf({ commanders: [], mainboard: [land(36)] });
    expect(s.winSpeed.score).toBe(0);
    expect(s.winSpeed.bestLine).toBeNull();
  });
});

describe('combination', () => {
  it('lets a compact combo deck outrank a pure acceleration deck', () => {
    // The brief's Deck A vs Deck B case.
    const acceleration = synthetic('fast-mana-no-win');
    const combo = synthetic('combo-oracle-consultation');
    expect(combo.score).toBeGreaterThan(acceleration.score);
  });

  it('throttles a combo deck that cannot develop', () => {
    const good = synthetic('combo-oracle-consultation').score;
    const stranded = synthetic('compact-win-low-acceleration').score;
    expect(stranded).toBeLessThan(good);
  });

  it('weights win speed above development', () => {
    const s = synthetic('combo-oracle-consultation');
    // Win speed exceeds development here, and the final score sits closer to it.
    expect(s.winSpeed.score).toBeGreaterThan(s.development.score);
    const midpoint = (s.winSpeed.score + s.development.score) / 2;
    expect(s.score).toBeGreaterThan(midpoint * 0.75);
  });
});

describe('limitations reporting', () => {
  it('flags unscored efficient tutors', () => {
    const s = speedOf({ commanders: [], mainboard: [
      one('Demonic Tutor'), one('Vampiric Tutor'), one('Bitterblossom'), land(36),
    ] });
    expect(s.limitations.some((l) => /tutor/i.test(l))).toBe(true);
  });

  it('flags partial combos', () => {
    const s = speedOf({ commanders: [], mainboard: [one('Walking Ballista'), land(36)] });
    expect(s.limitations.some((l) => /partial combo/i.test(l))).toBe(true);
  });

  it('flags incomplete win_condition coverage when nothing is recognised', () => {
    // A deck with a defining archetype but no recognised finisher at all.
    const s = synthetic('battlecruiser-high-ramp-high-curve');
    if (s.winSpeed.bestLine?.kind === 'archetype') {
      expect(s.limitations.some((l) => /win_condition/i.test(l))).toBe(true);
    }
  });

  it('flags X-cost pieces reporting printed MV 0', () => {
    const s = synthetic('combo-commander-involved');
    expect(s.limitations.some((l) => /printed MV 0/i.test(l))).toBe(true);
  });
});
