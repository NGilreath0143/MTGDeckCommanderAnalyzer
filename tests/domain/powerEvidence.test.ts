import { describe, expect, it } from 'vitest';
import { extractDeckPowerEvidence } from '@/domain/powerEvidence';
import { analyzeDeckStrategy } from '@/domain/strategy';
import { inferDeckArchetypes } from '@/domain/archetypes';
import { POWER_PROPERTIES } from '@/domain/powerCards';
import type { DeckComposition } from '@/domain/types';
import { basicLand, makeCard } from '../fixtures/cards';
import { realCard } from '../fixtures/roleCards';

const evidenceFor = (composition: DeckComposition) => {
  const strategy = analyzeDeckStrategy(composition);
  const archetypes = inferDeckArchetypes(composition, strategy);
  return extractDeckPowerEvidence(composition, strategy, archetypes);
};

const deck = (mainboard: string[], commanders: string[] = [], pad = 0): DeckComposition => {
  const entries = mainboard.map((n) => ({ card: realCard(n), quantity: 1 }));
  if (pad > 0) entries.push({ card: basicLand('Forest', 'G'), quantity: pad });
  return { commanders: commanders.map(realCard), mainboard: entries };
};

describe('shape and provenance', () => {
  it('exposes every property count', () => {
    const e = evidenceFor(deck([]));
    expect(Object.keys(e.propertyCounts).sort()).toEqual([...POWER_PROPERTIES].sort());
  });

  it('adds no score, rating, or turn prediction', () => {
    const e = evidenceFor(deck(['Sol Ring']));
    const json = JSON.stringify(e);
    expect(json).not.toMatch(/powerScore|powerLevel|"rating"|turnToWin/i);
  });

  it('preserves per-card provenance', () => {
    const e = evidenceFor(deck(['Sol Ring']));
    const entry = e.cardProperties.find((c) => c.name === 'Sol Ring');
    expect(entry).toMatchObject({ property: 'fast_mana', ruleId: 'net-positive-mana' });
  });

  it('handles an empty deck without dividing by zero', () => {
    const e = evidenceFor(deck([]));
    expect(e.mana.averageManaValue).toBe(0);
    expect(e.manaBase.landPercentage).toBe(0);
    expect(Number.isFinite(e.mana.medianManaValue)).toBe(true);
  });
});

describe('curve evidence', () => {
  it('excludes lands from the spell curve', () => {
    const e = evidenceFor(deck(['Sol Ring'], [], 20));
    // 20 basics must not appear in the curve buckets.
    const bucketTotal = e.mana.mv0 + e.mana.mv1 + e.mana.mv2 + e.mana.mv3 +
      e.mana.mv4 + e.mana.mv5 + e.mana.mv6Plus;
    expect(bucketTotal).toBe(1);
  });

  it('counts early plays and expensive cards by the stated boundaries', () => {
    const e = evidenceFor(deck(['Sol Ring', 'Counterspell', 'Craterhoof Behemoth']));
    // Sol Ring MV1 and Counterspell MV2 are early; Craterhoof MV8 is expensive.
    expect(e.mana.earlyPlayCount).toBe(2);
    expect(e.mana.expensiveCardCount).toBe(1);
  });

  it('separates fast mana from ordinary ramp', () => {
    const e = evidenceFor(deck(['Sol Ring', 'Arcane Signet', 'Cultivate']));
    expect(e.mana.fastManaCount).toBe(1);
    expect(e.mana.rampCount).toBeGreaterThan(1);
  });

  it('keeps Scryfall X semantics in the curve', () => {
    const e = evidenceFor(deck(['Walking Ballista']));
    expect(e.mana.mv0).toBe(1);
  });
});

describe('interaction evidence', () => {
  it('counts a modal card once but covers several categories', () => {
    const e = evidenceFor(deck(['Abrade']));
    expect(e.interaction.interactionCount).toBe(1);
    expect(e.interaction.targetCoverage.creature).toBe(1);
    expect(e.interaction.targetCoverage.artifact).toBe(1);
  });

  it('separates stack from permanent interaction', () => {
    const e = evidenceFor(deck(['Counterspell', 'Swords to Plowshares']));
    expect(e.interaction.stackInteractionCount).toBe(1);
    expect(e.interaction.permanentInteractionCount).toBe(1);
  });

  it('counts free counterspells separately', () => {
    const e = evidenceFor(deck(['Force of Will', 'Counterspell']));
    expect(e.interaction.counterspellCount).toBe(2);
    expect(e.interaction.freeCounterspellCount).toBe(1);
  });
});

describe('card advantage evidence', () => {
  it('exposes total, efficient, repeatable, and both', () => {
    const e = evidenceFor(deck(['Rhystic Study', "Night's Whisper", 'Phyrexian Arena']));
    expect(e.cardAdvantage.efficientCardAdvantageCount).toBe(2);
    expect(e.cardAdvantage.repeatableCardAdvantageCount).toBe(2);
    // Rhystic Study is both; Night's Whisper efficient only; Arena repeatable only.
    expect(e.cardAdvantage.efficientAndRepeatableCount).toBe(1);
  });
});

describe('stax evidence', () => {
  it('counts a stax card once while covering categories', () => {
    const e = evidenceFor(deck(['Rule of Law']));
    expect(e.stax.staxCount).toBe(1);
  });

  it('excludes pillow-fort and one-shot graveyard removal from stax', () => {
    const e = evidenceFor(deck(['Propaganda', 'Ghostly Prison', "Tormod's Crypt", 'Grand Abolisher']));
    expect(e.stax.staxCount).toBe(0);
  });

  it('keeps persistent graveyard locks as stax', () => {
    // Rest in Peace is a continuous system-wide replacement, unlike a
    // one-shot Tormod's Crypt activation.
    expect(evidenceFor(deck(['Rest in Peace'])).stax.staxCount).toBe(1);
  });

  it('excludes restrictions aimed at a single object', () => {
    const aura = makeCard({
      name: 'Test Pacifism',
      typeLine: 'Enchantment — Aura',
      oracleText: "Enchant creature\nEnchanted creature can't attack or block.",
    });
    const e = evidenceFor({ commanders: [], mainboard: [{ card: aura, quantity: 1 }] });
    expect(e.stax.staxCount).toBe(0);
  });
});

describe('win package and combos', () => {
  it('reports combos, overlap, and commander involvement', () => {
    const e = evidenceFor(deck(["Thassa's Oracle", 'Demonic Consultation', 'Tainted Pact']));
    expect(e.winPackage.detectedCompactComboCount).toBe(2);
    expect(e.winPackage.uniqueComboPieces).toBe(3);
    expect(e.winPackage.sharedComboPieces).toBe(1);
    expect(e.winPackage.deterministicWinComboCount).toBe(2);
  });

  it('records command-zone combo pieces', () => {
    const e = evidenceFor(deck(['Walking Ballista'], ['Heliod, Sun-Crowned']));
    const combo = e.winPackage.combos.find((c) => c.id === 'heliod+walking-ballista');
    expect(combo?.piecesInCommandZone).toBe(1);
  });

  it('distinguishes win conditions from combo pieces', () => {
    const e = evidenceFor(deck(['Demonic Consultation', 'Craterhoof Behemoth']));
    expect(e.winPackage.comboPieceCount).toBe(1);
    expect(e.winPackage.winConditionCount).toBe(1);
  });

  it('reports pieces still needed from the library', () => {
    const e = evidenceFor(deck(["Thassa's Oracle"]));
    expect(e.consistency.comboPiecesNeededFromLibrary).toBeGreaterThan(0);
  });
});

describe('primary strategy reuse', () => {
  it('reuses Phase 3C evidence for redundancy and commander engine', () => {
    // Enough token generation for the Phase 3C Tokens anchor to fire, so a
    // primary strategy actually exists to measure redundancy against.
    const composition: DeckComposition = {
      commanders: [realCard('Purphoros, God of the Forge')],
      mainboard: [
        { card: realCard('Bitterblossom'), quantity: 6 },
        { card: realCard('Intangible Virtue'), quantity: 2 },
        { card: realCard('Impact Tremors'), quantity: 2 },
      ],
    };
    const e = evidenceFor(composition);
    expect(e.commanderEngine.commanderProvidesPrimaryEngine).toBe(true);
    expect(e.commanderEngine.commanderPrimaryTags.length).toBeGreaterThan(0);
    expect(e.resilience.primaryStrategyRedundancy).toBeGreaterThan(0);
  });

  it('reports no commander engine when the commander is unrelated', () => {
    const e = evidenceFor(deck(['Bitterblossom'], ['Sol Ring']));
    expect(e.commanderEngine.commanderProvidesPrimaryEngine).toBe(false);
  });
});

describe('determinism', () => {
  it('produces identical output for identical input', () => {
    const composition = deck(['Sol Ring', 'Rhystic Study'], ['Purphoros, God of the Forge'], 5);
    const a = JSON.stringify(evidenceFor(composition));
    const b = JSON.stringify(evidenceFor(composition));
    expect(a).toBe(b);
  });
});
