import type { DeckComposition, ResolvedCard } from '@/domain/types';
import { realCard } from '../roleCards';
import { basicLand, makeCard } from '../cards';

/**
 * Small synthetic decks for SPEED evaluation.
 *
 * The nine real fixtures contain no complete curated combo, so these exercise
 * combo lines, accessibility, setup burden, and the non-combo extremes. They
 * exist to probe formula behaviour, NOT to hit target scores.
 */

const filler = (n: number, mv: number, name: string): { card: ResolvedCard; quantity: number } => ({
  card: makeCard({ name, typeLine: 'Creature — Human', cmc: mv, manaCost: `{${mv}}`, oracleText: '' }),
  quantity: n,
});

const lands = (n: number) => ({ card: basicLand('Forest', 'G'), quantity: n });
const taplands = (n: number) => ({
  card: makeCard({
    name: 'Slow Land',
    typeLine: 'Land',
    manaCost: '',
    cmc: 0,
    oracleText: 'This land enters tapped.\n{T}: Add {B}.',
  }),
  quantity: n,
});
const one = (name: string) => ({ card: realCard(name), quantity: 1 });
const many = (name: string, n: number) => ({ card: realCard(name), quantity: n });

export interface SyntheticSpeedDeck {
  id: string;
  description: string;
  composition: DeckComposition;
}

export const SYNTHETIC_SPEED_DECKS: SyntheticSpeedDeck[] = [
  {
    id: 'combo-oracle-consultation',
    description: 'Compact 2-card deterministic win, library requirement only',
    composition: {
      commanders: [],
      mainboard: [
        one("Thassa's Oracle"),
        one('Demonic Consultation'),
        many('Sol Ring', 1),
        filler(20, 2, 'Cheap Spell'),
        lands(36),
      ],
    },
  },
  {
    id: 'combo-commander-involved',
    description: 'Same size combo with one piece in the command zone (Heliod)',
    composition: {
      commanders: [realCard('Heliod, Sun-Crowned')],
      mainboard: [one('Walking Ballista'), filler(20, 2, 'Cheap Spell'), lands(36)],
    },
  },
  {
    id: 'combo-three-card',
    description: '3-card deterministic win with graveyard and mana requirements',
    composition: {
      commanders: [],
      mainboard: [
        one('Underworld Breach'),
        one("Lion's Eye Diamond"),
        one('Brain Freeze'),
        filler(20, 2, 'Cheap Spell'),
        lands(36),
      ],
    },
  },
  {
    id: 'combo-resource-no-outlet',
    description: 'Infinite mana with no obvious sink (Basalt + Rings)',
    composition: {
      commanders: [],
      mainboard: [
        one('Basalt Monolith'),
        one('Rings of Brighthearth'),
        filler(20, 3, 'Midrange Spell'),
        lands(36),
      ],
    },
  },
  {
    id: 'fast-mana-no-win',
    description: 'Heavy acceleration, no compact win line',
    composition: {
      commanders: [],
      mainboard: [
        one('Sol Ring'), one('Mana Crypt'), one('Mana Vault'), one('Chrome Mox'),
        one('Mox Diamond'), one('Lotus Petal'), one('Dark Ritual'), one('Grim Monolith'),
        many('Cultivate', 4), many('Rampant Growth', 4),
        filler(15, 3, 'Value Spell'),
        lands(36),
      ],
    },
  },
  {
    id: 'compact-win-low-acceleration',
    description: 'Compact combo but almost no mana development and slow lands',
    composition: {
      commanders: [],
      mainboard: [
        one("Thassa's Oracle"),
        one('Demonic Consultation'),
        filler(25, 5, 'Expensive Spell'),
        taplands(30),
        lands(6),
      ],
    },
  },
  {
    id: 'battlecruiser-high-ramp-high-curve',
    description: 'Lots of ordinary ramp, very high curve, no compact win',
    composition: {
      commanders: [],
      mainboard: [
        many('Cultivate', 6), many('Rampant Growth', 5), many('Kodama\'s Reach', 4),
        filler(20, 7, 'Giant Threat'),
        lands(38),
      ],
    },
  },
  {
    id: 'low-curve-reactive',
    description: 'Very cheap but almost entirely reactive: counters and removal',
    composition: {
      commanders: [],
      mainboard: [
        many('Counterspell', 6), many('Swords to Plowshares', 6),
        many('Swan Song', 5), many('Path to Exile', 5),
        many('Brainstorm', 5), many('Ponder', 5),
        lands(36),
      ],
    },
  },
  {
    id: 'combat-with-finisher',
    description: 'Token/go-wide board with an aligned curated finisher',
    composition: {
      commanders: [realCard('Purphoros, God of the Forge')],
      mainboard: [
        many('Bitterblossom', 6), many('Intangible Virtue', 3),
        many('Impact Tremors', 2), one('Craterhoof Behemoth'),
        many('Cultivate', 3),
        filler(15, 3, 'Creature'),
        lands(36),
      ],
    },
  },
  {
    id: 'combat-without-finisher',
    /*
     * Deliberately contains NO recognised win condition at all. Purphoros is
     * itself a curated finisher, so it is replaced by a token commander that
     * generates a board without closing the game.
     */
    description: 'Same token board with no recognised finisher',
    composition: {
      commanders: [realCard('Bitterblossom')],
      mainboard: [
        many('Bitterblossom', 5), many('Intangible Virtue', 3),
        many('Impact Tremors', 2),
        many('Cultivate', 3),
        filler(16, 3, 'Creature'),
        lands(36),
      ],
    },
  },
];
