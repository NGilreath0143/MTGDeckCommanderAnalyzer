import type { DeckComposition, ResolvedCard } from '@/domain/types';
import { realCard } from '../roleCards';
import { basicLand, makeCard } from '../cards';

/**
 * Small synthetic decks for CONSISTENCY evaluation.
 *
 * These isolate one variable at a time — tutors vs. redundancy, a commander
 * engine with and without backup, an optional function present or absent — so
 * a component's behaviour can be read directly from the difference between a
 * pair. They exist to probe formula behaviour, NOT to hit target scores.
 */

const filler = (n: number, name: string): { card: ResolvedCard; quantity: number } => ({
  card: makeCard({ name, typeLine: 'Creature — Human', cmc: 3, manaCost: '{2}{G}', oracleText: '' }),
  quantity: n,
});

const lands = (n: number) => ({ card: basicLand('Forest', 'G'), quantity: n });
const one = (name: string) => ({ card: realCard(name), quantity: 1 });
const many = (name: string, n: number) => ({ card: realCard(name), quantity: n });

export interface SyntheticConsistencyDeck {
  id: string;
  description: string;
  composition: DeckComposition;
}

/** Tokens core shared by the doubling-comparison pair. */
const TOKENS_CORE = [
  one('Bitterblossom'),
  one('Cryptbreaker'),
  one('Academy Manufactor'),
  one('Dockside Extortionist'),
  one('Goldspan Dragon'),
  one('Impact Tremors'),
  one("Cathars' Crusade"),
  one('Intangible Virtue'),
  one('Skullclamp'),
];

export const SYNTHETIC_CONSISTENCY_DECKS: SyntheticConsistencyDeck[] = [
  {
    id: 'tokens-without-doubling',
    description: 'Tokens with both required functions, optional token_doubling absent',
    composition: {
      commanders: [],
      mainboard: [...TOKENS_CORE, filler(54, 'Filler'), lands(37)],
    },
  },
  {
    id: 'tokens-with-doubling',
    description: 'Same Tokens deck plus token_doubling: the optional must never lower the score',
    composition: {
      commanders: [],
      mainboard: [
        ...TOKENS_CORE,
        one('Anointed Procession'),
        one('Parallel Lives'),
        one('Doubling Season'),
        filler(51, 'Filler'),
        lands(37),
      ],
    },
  },
  {
    id: 'tokens-single-weak-optional',
    description: 'Exactly one token_doubling card: the weak-optional case that used to penalise',
    composition: {
      commanders: [],
      mainboard: [...TOKENS_CORE, one('Parallel Lives'), filler(53, 'Filler'), lands(37)],
    },
  },
  {
    id: 'high-tutors-low-redundancy',
    description: 'Heavy targeted access over a thin Tokens shell: access without reproducibility',
    composition: {
      commanders: [],
      mainboard: [
        one('Demonic Tutor'),
        one('Vampiric Tutor'),
        one('Imperial Seal'),
        one('Diabolic Tutor'),
        one('Diabolic Intent'),
        one('Eladamri\'s Call'),
        one('Worldly Tutor'),
        // a thin Tokens shell: the anchor is met, but the payoff function
        // rests on a single card
        one('Bitterblossom'),
        one('Cryptbreaker'),
        one('Academy Manufactor'),
        one('Dockside Extortionist'),
        one('Goldspan Dragon'),
        one('Impact Tremors'),
        filler(49, 'Filler'),
        lands(37),
      ],
    },
  },
  {
    id: 'low-tutors-high-redundancy',
    description: 'Same Tokens archetype, no tutors, deep support for every function',
    composition: {
      commanders: [],
      mainboard: [
        // no tutors at all
        one('Bitterblossom'),
        one('Cryptbreaker'),
        one('Academy Manufactor'),
        one('Dockside Extortionist'),
        one('Goldspan Dragon'),
        one('Bloodforged Battle-Axe'),
        one('Ancestral Blade'),
        one('Impact Tremors'),
        one("Cathars' Crusade"),
        one('Intangible Virtue'),
        one('Skullclamp'),
        one('Ashnod\'s Altar'),
        filler(51, 'Filler'),
        lands(37),
      ],
    },
  },
  {
    id: 'commander-engine-no-redundancy',
    description: 'Commander supplies the only engine piece',
    composition: {
      commanders: [realCard('Talrand, Sky Summoner')],
      mainboard: [
        // instants/sorceries establish the spellslinger anchor without adding
        // any second copy of the spell_payoff function the commander supplies
        many('Ponder', 8),
        many('Opt', 8),
        one('Counterspell'),
        filler(45, 'Filler'),
        lands(37),
      ],
    },
  },
  {
    id: 'commander-engine-with-redundancy',
    description: 'Same commander engine, backed by mainboard copies of the function',
    composition: {
      commanders: [realCard('Talrand, Sky Summoner')],
      mainboard: [
        many('Ponder', 8),
        many('Opt', 8),
        one('Counterspell'),
        // the same function the commander supplies, repeated in the mainboard
        one('Young Pyromancer'),
        one('Murmuring Mystic'),
        one('Archmage Emeritus'),
        one('Guttersnipe'),
        filler(41, 'Filler'),
        lands(37),
      ],
    },
  },
  {
    id: 'aura-voltron-no-aura',
    description: 'Equipment-style voltron: the aura required function is genuinely absent',
    composition: {
      commanders: [realCard('Bruenor Battlehammer')],
      mainboard: [one('Nettlecyst'), one('Umezawa\'s Jitte'), filler(60, 'Filler'), lands(37)],
    },
  },
  {
    id: 'combo-no-tutor',
    description: 'Complete Oracle + Consultation combo, drawn naturally: no way to find it',
    composition: {
      commanders: [],
      mainboard: [
        one("Thassa's Oracle"),
        one('Demonic Consultation'),
        filler(61, 'Filler'),
        lands(37),
      ],
    },
  },
  {
    id: 'combo-relevant-tutor',
    description: 'Same combo plus Demonic Tutor, which can find either piece',
    composition: {
      commanders: [],
      mainboard: [
        one("Thassa's Oracle"),
        one('Demonic Consultation'),
        one('Demonic Tutor'),
        filler(60, 'Filler'),
        lands(37),
      ],
    },
  },
  {
    id: 'combo-irrelevant-tutor',
    description: 'Same combo plus Enlightened Tutor, which finds neither piece',
    composition: {
      commanders: [],
      mainboard: [
        one("Thassa's Oracle"),
        one('Demonic Consultation'),
        one('Enlightened Tutor'),
        filler(60, 'Filler'),
        lands(37),
      ],
    },
  },
];
