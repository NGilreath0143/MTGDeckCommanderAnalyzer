import { describe, expect, it } from 'vitest';
import { ratingFor, scoreResilience } from '@/domain/resilience';
import { analyzeDeckStrategy } from '@/domain/strategy';
import { inferDeckArchetypes } from '@/domain/archetypes';
import { extractDeckPowerEvidence } from '@/domain/powerEvidence';
import type { DeckComposition } from '@/domain/types';
import { basicLand, makeCard } from '../fixtures/cards';
import { SYNTHETIC_RESILIENCE_DECKS } from '../fixtures/resilience/syntheticDecks';

const resilienceOf = (composition: DeckComposition) => {
  const strategy = analyzeDeckStrategy(composition);
  const archetypes = inferDeckArchetypes(composition, strategy);
  const evidence = extractDeckPowerEvidence(composition, strategy, archetypes);
  return scoreResilience(composition, evidence, archetypes);
};

const synthetic = (id: string) => {
  const deck = SYNTHETIC_RESILIENCE_DECKS.find((d) => d.id === id);
  if (!deck) throw new Error(`no synthetic deck ${id}`);
  return resilienceOf(deck.composition);
};

const land = (n: number) => ({ card: basicLand('Forest', 'G'), quantity: n });
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
  it('bounds the total and every component', () => {
    for (const deck of SYNTHETIC_RESILIENCE_DECKS) {
      const r = resilienceOf(deck.composition);
      expect(r.score, deck.id).toBeGreaterThanOrEqual(0);
      expect(r.score, deck.id).toBeLessThanOrEqual(100);
      for (const [n, c] of [
        ['recovery', r.recovery], ['protection', r.protection],
        ['redundancy', r.redundancy], ['commanderBackup', r.commanderBackup],
      ] as const) {
        expect(c.score, `${deck.id}/${n}`).toBeGreaterThanOrEqual(0);
        expect(c.score, `${deck.id}/${n}`).toBeLessThanOrEqual(c.max);
      }
    }
  });

  it('sums the four components into the total', () => {
    for (const deck of SYNTHETIC_RESILIENCE_DECKS) {
      const r = resilienceOf(deck.composition);
      const sum = r.recovery.score + r.protection.score + r.redundancy.score + r.commanderBackup.score;
      expect(Math.abs(sum - r.score), deck.id).toBeLessThan(0.05);
    }
  });

  it('component maxima total exactly 100', () => {
    const r = synthetic('balanced-engine');
    expect(r.recovery.max + r.protection.max + r.redundancy.max + r.commanderBackup.max).toBe(100);
  });

  it('scores an empty deck at zero', () => {
    const r = resilienceOf({ commanders: [], mainboard: [filler(62), land(37)] });
    expect(r.score).toBe(0);
  });
});

describe('prevention and recovery stay separate', () => {
  it('ranks protected+recovery above protected-only above glass cannon', () => {
    const both = synthetic('protected-and-recovery').score;
    const prot = synthetic('protected-only').score;
    const glass = synthetic('glass-cannon').score;
    expect(both).toBeGreaterThan(prot);
    expect(prot).toBeGreaterThan(glass);
  });

  it('ranks protected+recovery above recovery-only above glass cannon', () => {
    const both = synthetic('protected-and-recovery').score;
    const rec = synthetic('recovery-only').score;
    const glass = synthetic('glass-cannon').score;
    expect(both).toBeGreaterThan(rec);
    expect(rec).toBeGreaterThan(glass);
  });

  it('does not let protection supply recovery, or recovery supply protection', () => {
    /*
     * Adding protection must not move recovery, and adding rebuild pieces must
     * not move protection. For a generation archetype the engine cards ARE the
     * rebuild, so recovery is compared between decks rather than to zero.
     */
    const glass = synthetic('glass-cannon');
    const prot = synthetic('protected-only');
    const rec = synthetic('recovery-only');
    expect(prot.recovery.score).toBeCloseTo(glass.recovery.score, 2);
    expect(rec.protection.raw.totalProtection).toBe(0);
    expect(prot.protection.score).toBeGreaterThan(glass.protection.score);
  });

  it('counts an efficient protection card once, at its stronger tier', () => {
    for (const deck of SYNTHETIC_RESILIENCE_DECKS) {
      const raw = resilienceOf(deck.composition).protection.raw;
      expect(Number(raw.efficientProtection) + Number(raw.ordinaryProtection), deck.id)
        .toBe(Number(raw.totalProtection));
    }
  });
});

describe('recovery relevance is archetype-scoped', () => {
  it('beats equal-volume off-plan recursion', () => {
    /*
     * Both decks add six cards to the same Tokens shell: one adds on-plan
     * rebuild pieces, the other adds six graveyard-recursion cards that do
     * nothing for a Tokens plan. Only the shell is common, so the gap is
     * entirely attributable to relevance.
     */
    const onPlan = synthetic('recovery-only');
    const offPlan = synthetic('off-plan-recursion');
    expect(Number(onPlan.recovery.raw.relevant))
      .toBeGreaterThan(Number(offPlan.recovery.raw.relevant));
    expect(Number(offPlan.recovery.raw.generic)).toBeGreaterThan(0);
    expect(onPlan.recovery.score).toBeGreaterThan(offPlan.recovery.score);
  });

  it('still gives off-plan recursion a small, non-zero share', () => {
    const off = synthetic('off-plan-recursion');
    expect(Number(off.recovery.raw.generic)).toBeGreaterThan(0);
    expect(off.recovery.score).toBeGreaterThan(0);
  });

  it('treats graveyard recursion as on-plan for a reanimator deck', () => {
    const r = synthetic('graveyard-recursion-plan');
    expect(r.recovery.raw.primaryArchetype).toBe('reanimator');
    for (const name of ['Regrowth', 'Eternal Witness', 'Animate Dead']) {
      expect(r.recovery.relevantCards, name).toContain(name);
    }
  });

  it('treats land recursion as on-plan for a lands deck', () => {
    const r = synthetic('lands-recursion-plan');
    expect(r.recovery.raw.primaryArchetype).toBe('lands');
    expect(r.recovery.relevantCards).toContain('Crucible of Worlds');
    expect(r.recovery.relevantCards).toContain('Life from the Loam');
  });

  it('never treats the bare recursion role as sufficient relevance', () => {
    /*
     * The six added cards all carry the Phase 2 recursion role and none is
     * relevant to Tokens; they land in the generic bucket instead.
     */
    const off = synthetic('off-plan-recursion');
    for (const name of ['Regrowth', 'Eternal Witness', 'Reanimate', 'Necromancy']) {
      expect(off.recovery.genericCards, name).toContain(name);
      expect(off.recovery.relevantCards, name).not.toContain(name);
    }
  });
});

describe('weakest-link redundancy', () => {
  it('reads the minimum required function, not the mean', () => {
    const thin = synthetic('thin-weakest-link');
    const balanced = synthetic('balanced-engine');
    expect(thin.redundancy.minimumSupport).toBeLessThan(balanced.redundancy.minimumSupport);
    expect(thin.redundancy.score).toBeLessThan(balanced.redundancy.score);
  });

  it('exposes every required function with its support', () => {
    const r = synthetic('balanced-engine');
    expect(r.redundancy.functions.length).toBeGreaterThan(0);
    for (const f of r.redundancy.functions) {
      expect(f.id).toBeTruthy();
      expect(f.support).toBeGreaterThanOrEqual(0);
    }
    const min = Math.min(...r.redundancy.functions.map((f) => f.support));
    expect(r.redundancy.minimumSupport).toBe(min);
  });

  it('uses the single function as the minimum when only one is required', () => {
    const r = synthetic('lands-recursion-plan');
    if (r.redundancy.functions.length === 1) {
      expect(r.redundancy.minimumSupport).toBe(r.redundancy.functions[0]!.support);
    }
  });
});

describe('commander backup', () => {
  it('rises with backup depth', () => {
    const zero = synthetic('commander-engine-zero-backup').commanderBackup;
    const one1 = synthetic('commander-engine-one-backup').commanderBackup;
    const three = synthetic('commander-engine-three-backups').commanderBackup;
    expect(zero.status).toBe('applicable');
    expect(one1.score).toBeGreaterThan(zero.score);
    expect(three.score).toBeGreaterThan(one1.score);
  });

  it('has no command-zone floor: zero backup scores zero', () => {
    /*
     * Availability from the command zone is a CONSISTENCY property, not a
     * resilience one. A floor also paid an incidental primary-tag commander
     * exactly what it paid a genuine engine.
     */
    const zero = synthetic('commander-engine-zero-backup').commanderBackup;
    expect(zero.status).toBe('applicable');
    expect(zero.minimumBackup).toBe(0);
    expect(zero.score).toBe(0);
  });

  it('scores an unknown commander at zero and says so', () => {
    /*
     * Unknown must never silently become average: existing evidence cannot
     * separate a genuine non-contributor from a Phase 3A vocabulary gap.
     */
    const r = synthetic('commander-unknown-evidence');
    expect(r.commanderBackup.status).toBe('unknown');
    expect(r.commanderBackup.score).toBe(0);
    expect(r.commanderBackup.raw.scoreAvailable).toBe(false);
    expect(r.limitations.join(' ')).toMatch(/UNAVAILABLE, not zero/);
  });

  it('scores a commanderless deck as not_applicable, not unknown', () => {
    const r = synthetic('glass-cannon');
    expect(r.commanderBackup.status).toBe('not_applicable');
    expect(r.commanderBackup.score).toBe(0);
  });

  it('reports backup per tag, not as a lumped count', () => {
    const r = synthetic('commander-engine-three-backups');
    expect(Object.keys(r.commanderBackup.backupByTag).length).toBeGreaterThan(0);
    const min = Math.min(...Object.values(r.commanderBackup.backupByTag));
    expect(r.commanderBackup.minimumBackup).toBe(min);
  });
});

describe('recovery excludes generation', () => {
  it('gives no recovery to an archetype that rebuilds by generating', () => {
    /*
     * Making a fresh token is not recovering a lost one, and that capability
     * is already measured by weakest-link redundancy. Counting it here would
     * credit the same engine cards twice.
     */
    const gen = synthetic('generators-no-recursion');
    expect(gen.recovery.raw.primaryArchetype).toBe('tokens');
    expect(gen.recovery.raw.vocabulary).toBe('(none defined)');
    expect(gen.recovery.score).toBe(0);
    // ...but redundancy still credits the engine.
    expect(gen.redundancy.score).toBeGreaterThan(0);
  });

  it('credits both redundancy and recovery when recursion is genuinely on-plan', () => {
    const gen = synthetic('generators-no-recursion');
    const rec = synthetic('on-plan-recursion');
    expect(gen.recovery.score).toBe(0);
    expect(rec.recovery.score).toBeGreaterThan(0);
    expect(rec.redundancy.score).toBeGreaterThan(0);
  });

  it('scores the same six recursion cards differently by archetype', () => {
    // Identical cards: on-plan for Reanimator, off-plan for Tokens.
    const onPlan = synthetic('on-plan-recursion');
    const offPlan = synthetic('off-plan-recursion');
    expect(onPlan.recovery.score).toBeGreaterThan(offPlan.recovery.score);
    expect(Number(offPlan.recovery.raw.relevant)).toBe(0);
  });
});

describe('limitations', () => {
  it('always discloses the frozen model characteristics, deck-independently', () => {
    /*
     * These describe the model, not the deck, so they must appear even for a
     * deck with no resilience evidence at all.
     */
    const bare = resilienceOf({ commanders: [], mainboard: [filler(62), land(37)] });
    const l = bare.limitations.join(' ');
    expect(l).toMatch(/commander DEPENDENCE is not measured/);
    expect(l).toMatch(/tag-level alternatives, not true functional/);
    expect(l).toMatch(/hexproof, indestructible, ward/);
    expect(l).toMatch(/board wipe/i);
  });

  it('flags an archetype with no recovery vocabulary', () => {
    const r = synthetic('commander-not-relevant');
    expect(r.recovery.raw.primaryArchetype).toBe('voltron');
    expect(r.limitations.join(' ')).toMatch(/no recovery vocabulary exists/);
  });
});
