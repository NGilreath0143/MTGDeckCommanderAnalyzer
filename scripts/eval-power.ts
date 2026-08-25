/**
 * Deck-level power-evidence diagnostics.
 *
 * DEVELOPER SCRIPT — never part of a request path. Informational only: it never
 * exits non-zero, and it produces NO score, rating, or turn prediction.
 *
 *   npx tsx scripts/eval-power.ts [deck.txt ...]
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { composeDeck } from '@/domain/buildProfile';
import { parseDecklist } from '@/domain/parseDecklist';
import { analyzeDeckStrategy } from '@/domain/strategy';
import { inferDeckArchetypes } from '@/domain/archetypes';
import { extractDeckPowerEvidence } from '@/domain/powerEvidence';
import { CURATED_SET_SIZES, POWER_PROPERTIES } from '@/domain/powerCards';
import { resolveCards } from '@/pipeline/resolveCards';
import { cardRepo } from '@/infra/db/cardRepo';
import { createScryfallClient } from '@/infra/scryfall/client';

const DECK_DIR = 'tests/fixtures/decklists';
const args = process.argv.slice(2).filter((a) => a.endsWith('.txt'));
const deckFiles =
  args.length > 0
    ? args
    : readdirSync(DECK_DIR).filter((f) => f.endsWith('.txt')).map((f) => join(DECK_DIR, f));

const scryfall = createScryfallClient();

console.log('curated set sizes:', JSON.stringify(CURATED_SET_SIZES));

for (const file of deckFiles) {
  const parsed = parseDecklist(readFileSync(file, 'utf8'));
  const names = [...new Set(parsed.entries.map((e) => e.name))];
  const { byName, unresolvedNames } = await resolveCards(names, { cardRepo, scryfall });
  const { composition } = composeDeck(parsed, byName);

  const strategy = analyzeDeckStrategy(composition);
  const archetypes = inferDeckArchetypes(composition, strategy);
  const e = extractDeckPowerEvidence(composition, strategy, archetypes);

  const primary = archetypes.inferences
    .filter((i) => i.anchorSatisfied)
    .sort((a, b) => b.score - a.score)[0];

  console.log(`\n${'='.repeat(78)}`);
  console.log(`DECK: ${file}`);
  console.log(`commanders: ${composition.commanders.map((c) => c.name).join(' + ') || '(none)'}`);
  console.log(`primary archetype: ${primary ? `${primary.archetype} (${primary.score})` : '(none)'}`);
  if (unresolvedNames.length) console.log(`unresolved: ${unresolvedNames.join(', ')}`);
  console.log('='.repeat(78));

  console.log('\n--- MANA / CURVE ---');
  const m = e.mana;
  console.log(`  avgMV=${m.averageManaValue}  medianMV=${m.medianManaValue}`);
  console.log(
    `  curve: 0=${m.mv0} 1=${m.mv1} 2=${m.mv2} 3=${m.mv3} 4=${m.mv4} 5=${m.mv5} 6+=${m.mv6Plus}`,
  );
  console.log(`  earlyPlay(<=2)=${m.earlyPlayCount}  expensive(>=6)=${m.expensiveCardCount}`);
  console.log(`  ramp=${m.rampCount}  fastMana=${m.fastManaCount}`);
  console.log(`  ramp MVs: [${m.rampManaValues.join(',')}]`);

  console.log('\n--- TUTORS / CONSISTENCY ---');
  const c = e.consistency;
  console.log(`  tutors=${c.tutorCount}  efficientTutors=${c.efficientTutorCount}  cardSelection=${c.cardSelectionCount}`);
  console.log(`  cardAdvantage=${c.cardAdvantageCount}  efficient=${c.efficientCardAdvantageCount}  repeatable=${c.repeatableCardAdvantageCount}`);
  console.log(`  commanderProvidesPrimaryEngine=${c.commanderProvidesPrimaryEngine}`);
  console.log(`  primaryStrategyFunctionalSupport=${c.primaryStrategyFunctionalSupport}`);
  console.log(`  comboPiecesNeededFromLibrary=${c.comboPiecesNeededFromLibrary}`);

  console.log('\n--- INTERACTION ---');
  const i = e.interaction;
  console.log(`  total=${i.interactionCount}  targeted=${i.targetedInteractionCount}  boardWipes=${i.boardWipeCount}  graveyardHate=${i.graveyardHateCount}`);
  console.log(`  efficient=${i.efficientInteractionCount}  free=${i.freeInteractionCount}`);
  console.log(`  stack=${i.stackInteractionCount}  permanent=${i.permanentInteractionCount}  graveyard=${i.graveyardInteractionCount}`);
  console.log(`  counterspells=${i.counterspellCount}  efficient=${i.efficientCounterspellCount}  free=${i.freeCounterspellCount}`);
  console.log(`  coverage: ${Object.entries(i.targetCoverage).map(([k, v]) => `${k}=${v}`).join(' ')}`);

  console.log('\n--- PROTECTION / RESILIENCE ---');
  const r = e.resilience;
  console.log(`  protection=${r.protectionCount}  efficientProtection=${r.efficientProtectionCount}`);
  console.log(`  recursion=${r.recursionCount}  reanimation=${r.reanimationCount}  landRecursion=${r.landRecursionCount}  spellRecursion=${r.spellRecursionCount}`);
  console.log(`  primaryStrategyRedundancy=${r.primaryStrategyRedundancy}  commanderEngine=${r.commanderProvidesPrimaryEngine}`);

  console.log('\n--- CARD ADVANTAGE ---');
  const ca = e.cardAdvantage;
  console.log(`  total=${ca.cardAdvantageCount}  efficient=${ca.efficientCardAdvantageCount}  repeatable=${ca.repeatableCardAdvantageCount}  both=${ca.efficientAndRepeatableCount}`);

  console.log('\n--- STAX ---');
  console.log(`  staxCount=${e.stax.staxCount}`);
  const activeRestrictions = Object.entries(e.stax.restrictionCoverage).filter(([, v]) => v > 0);
  console.log(`  restrictions: ${activeRestrictions.map(([k, v]) => `${k}=${v}`).join(' ') || '(none)'}`);
  if (e.stax.cards.length) console.log(`  cards: ${e.stax.cards.join(', ')}`);

  console.log('\n--- MANA BASE ---');
  const mb = e.manaBase;
  console.log(`  lands=${mb.landCount} (mdfc=${mb.mdfcLandCount})  landPct=${mb.landPercentage}`);
  console.log(`  untapped=${mb.alwaysUntappedLandCount}  conditional=${mb.conditionalUntappedLandCount}  tapped=${mb.entersTappedLandCount}`);
  console.log(`  manaProducing=${mb.manaProducingLands}  nonMana=${mb.nonManaLands}  colorlessOnly=${mb.colorlessOnlyLandCount}  utility=${mb.utilityLandCount}`);
  console.log(`  sources: W=${mb.whiteSources} U=${mb.blueSources} B=${mb.blackSources} R=${mb.redSources} G=${mb.greenSources} C=${mb.colorlessSources}`);
  console.log(`  single=${mb.singleColorSources}  multi=${mb.multiColorSources}  any=${mb.anyColorSources}`);
  console.log(`  fetchlands=${mb.fetchLandCount}  fetchableTargets=${mb.fetchableLandCount}`);
  console.log(`  pips: W=${mb.whitePips} U=${mb.bluePips} B=${mb.blackPips} R=${mb.redPips} G=${mb.greenPips}`);
  console.log(`  demandingEarly: ${mb.demandingEarlyCosts.join(', ') || '(none)'}`);

  console.log('\n--- WIN PACKAGE ---');
  const w = e.winPackage;
  console.log(`  winConditions=${w.winConditionCount}  comboPieces=${w.comboPieceCount}`);
  console.log(`  detectedCombos=${w.detectedCompactComboCount}  deterministicWin=${w.deterministicWinComboCount}  resource=${w.resourceComboCount}`);
  console.log(`  uniquePieces=${w.uniqueComboPieces}  sharedPieces=${w.sharedComboPieces}`);
  for (const combo of w.combos) {
    console.log(
      `    ${combo.id}: result=${combo.result} size=${combo.comboSize} ` +
        `cmdZone=${combo.piecesInCommandZone} main=${combo.piecesInMainboard} ` +
        `needed=${combo.piecesNeededFromLibrary} printedMV=${combo.totalPrintedManaValue}`,
    );
    console.log(`      requirements: [${combo.requirements.join(', ')}]`);
    console.log(`      pieces: ${combo.pieces.map((p) => `${p.name}(${p.location})`).join(', ')}`);
  }

  console.log('\n--- POWER PROPERTY COUNTS ---');
  for (const p of POWER_PROPERTIES) {
    const cards = e.cardProperties.filter((cp) => cp.property === p).map((cp) => cp.name);
    console.log(`  ${p.padEnd(26)} ${String(e.propertyCounts[p]).padStart(3)}  ${cards.slice(0, 8).join(', ')}`);
  }
}
