import type { DeckComposition, ResolvedCard } from '@/domain/types';
import { realCard } from '../roleCards';
import { basicLand, makeCard } from '../cards';

/**
 * Small synthetic decks for INTERACTION evaluation.
 *
 * Each isolates ONE variable so a component's behaviour can be read from the
 * difference between a pair. They probe formula behaviour and relational
 * ordering, NOT target scores.
 */

const filler = (n: number, name = 'Filler'): { card: ResolvedCard; quantity: number } => ({
  card: makeCard({ name, typeLine: 'Creature — Human', cmc: 3, manaCost: '{2}{G}', oracleText: '' }),
  quantity: n,
});

const lands = (n: number) => ({ card: basicLand('Forest', 'G'), quantity: n });
const one = (name: string) => ({ card: realCard(name), quantity: 1 });

/** Pad to a legal-size 99-card mainboard so density normalises consistently. */
const pad = (used: number) => filler(Math.max(0, 62 - used));

export interface SyntheticInteractionDeck {
  id: string;
  description: string;
  composition: DeckComposition;
}

/** Twelve answers, mostly efficient, spanning several threat classes. */
const BROAD_EFFICIENT = [
  one('Swords to Plowshares'), one('Path to Exile'), one('Pongify'),
  one('Rapid Hybridization'), one("Nature's Claim"), one('Krosan Grip'),
  one('Abrade'), one("Hero's Downfall"), one('Beast Within'),
  one('Counterspell'), one('Swan Song'), one('Force of Will'),
];

/** Twelve answers of the same breadth, but expensive and unrefined. */
const BROAD_INEFFICIENT = [
  one('Reality Shift'), one('Unsummon'), one('Darksteel Mutation'),
  one('Lignify'), one("Kenrith's Transformation"), one('Song of the Dryads'),
  one('Imprisoned in the Moon'), one('Vindicate'), one('Decimate'),
  one('Stifle'), one('Mana Tithe'), one('Withering Boon'),
];

export const SYNTHETIC_INTERACTION_DECKS: SyntheticInteractionDeck[] = [
  {
    id: 'high-interaction-high-efficiency',
    description: 'Twelve answers, mostly efficient, one free: broad and cheap',
    composition: { commanders: [], mainboard: [...BROAD_EFFICIENT, pad(12), lands(37)] },
  },
  {
    id: 'high-interaction-low-efficiency',
    description: 'Twelve answers of comparable breadth but expensive: A > B expected',
    composition: { commanders: [], mainboard: [...BROAD_INEFFICIENT, pad(12), lands(37)] },
  },
  {
    id: 'creature-removal-only',
    description: 'Twelve answers, every one pointed at creatures: narrow coverage',
    composition: {
      commanders: [],
      mainboard: [
        one('Swords to Plowshares'), one('Path to Exile'), one('Pongify'),
        one('Rapid Hybridization'), one('Reality Shift'), one('Unsummon'),
        one("Hero's Downfall"), one('Deadly Rollick'), one('Lignify'),
        one('Darksteel Mutation'), one("Kenrith's Transformation"), one('Song of the Dryads'),
        pad(12), lands(37),
      ],
    },
  },
  {
    id: 'broad-low-count',
    description: 'Only eight answers, but spanning permanents, stack and graveyard',
    composition: {
      commanders: [],
      mainboard: [
        one('Beast Within'), one('Vindicate'), one('Krosan Grip'),
        one('Swords to Plowshares'), one('Counterspell'), one('Swan Song'),
        one('Bojuka Bog'), one('Relic of Progenitus'),
        pad(8), lands(37),
      ],
    },
  },
  {
    id: 'free-interaction-heavy',
    description: 'Every free answer available: interacts while fully tapped out',
    composition: {
      commanders: [],
      mainboard: [
        one('Force of Will'), one('Force of Negation'), one('Fierce Guardianship'),
        one('Daze'), one('Deadly Rollick'),
        one('Swords to Plowshares'), one('Path to Exile'),
        pad(7), lands(37),
      ],
    },
  },
  {
    id: 'counterspell-heavy',
    description: 'Stack interaction almost exclusively',
    composition: {
      commanders: [],
      mainboard: [
        one('Counterspell'), one('Swan Song'), one('Dovin’s Veto'.replace('’', "'")),
        one('Flusterstorm'), one('Mana Drain'), one('Stern Scolding'),
        one('An Offer You Can’t Refuse'.replace('’', "'")), one('Force of Will'),
        pad(8), lands(37),
      ],
    },
  },
  {
    id: 'no-stack-broad-permanent',
    description: 'Zero counterspells, broad permanent answers: must still score healthily',
    composition: {
      commanders: [],
      mainboard: [
        one('Beast Within'), one('Vindicate'), one('Generous Gift'),
        one('Krosan Grip'), one('Abrade'), one("Nature's Claim"),
        one('Swords to Plowshares'), one('Path to Exile'), one('Pongify'),
        one("Hero's Downfall"), one('Rapid Hybridization'), one('Decimate'),
        pad(12), lands(37),
      ],
    },
  },
  {
    id: 'board-wipe-heavy',
    description: 'Eight wipes, two targeted answers: reset without one-for-one interaction',
    composition: {
      commanders: [],
      mainboard: [
        one('Damnation'), one('Blasphemous Act'), one('Cleansing Nova'),
        one('Fumigate'), one('Languish'), one('Pyroclasm'),
        one('Austere Command'), one('Hour of Revelation'),
        one('Swords to Plowshares'), one('Path to Exile'),
        pad(10), lands(37),
      ],
    },
  },
  {
    id: 'efficient-targeted-few-wipes',
    description: 'Two wipes, eight efficient targeted answers: F > E expected',
    composition: {
      commanders: [],
      mainboard: [
        one('Damnation'), one('Blasphemous Act'),
        one('Swords to Plowshares'), one('Path to Exile'), one('Pongify'),
        one('Rapid Hybridization'), one("Nature's Claim"), one('Krosan Grip'),
        one('Abrade'), one('Deadly Rollick'),
        pad(10), lands(37),
      ],
    },
  },
  {
    id: 'graveyard-hate-heavy',
    description: 'Graveyard answers with little else: specialised axis only',
    composition: {
      commanders: [],
      mainboard: [
        one('Rest in Peace'), one('Leyline of the Void'), one('Relic of Progenitus'),
        one('Nihil Spellbomb'), one('Bojuka Bog'), one('Ground Seal'),
        one('Silent Gravestone'), one('Planar Void'),
        pad(8), lands(37),
      ],
    },
  },
  {
    id: 'stax-heavy-little-interaction',
    description: 'Five prison pieces, minimal conventional answers: credit but not elite',
    composition: {
      commanders: [],
      mainboard: [
        one('Winter Orb'), one('Static Orb'), one('Trinisphere'),
        one('Sphere of Resistance'), one('Rule of Law'),
        one('Swords to Plowshares'),
        pad(6), lands(37),
      ],
    },
  },
  {
    id: 'balanced-suite',
    description: 'A conventional, well-rounded interaction package',
    composition: {
      commanders: [],
      mainboard: [
        one('Swords to Plowshares'), one('Beast Within'), one('Krosan Grip'),
        one('Abrade'), one('Counterspell'), one('Swan Song'),
        one('Damnation'), one('Cyclonic Rift'),
        one('Bojuka Bog'), one('Relic of Progenitus'),
        pad(10), lands(37),
      ],
    },
  },
  {
    id: 'modal-three-flexible',
    description: 'Three modal answers: one physical card each, four coverage categories each',
    composition: {
      commanders: [],
      mainboard: [one('Beast Within'), one('Vindicate'), one('Generous Gift'), pad(3), lands(37)],
    },
  },
  {
    id: 'independent-three-narrow',
    description: 'Three single-purpose answers: same physical count, narrower coverage',
    composition: {
      commanders: [],
      mainboard: [
        one('Swords to Plowshares'), one("Nature's Claim"), one('Krosan Grip'),
        pad(3), lands(37),
      ],
    },
  },
];
