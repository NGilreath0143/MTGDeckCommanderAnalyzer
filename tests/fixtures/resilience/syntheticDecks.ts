import type { DeckComposition, ResolvedCard } from '@/domain/types';
import { realCard } from '../roleCards';
import { basicLand, makeCard } from '../cards';

/**
 * Small synthetic decks for RESILIENCE evaluation.
 *
 * Each isolates one variable so a component's behaviour can be read from the
 * difference between a pair. They probe formula behaviour and relational
 * ordering, NOT target scores.
 */

const filler = (n: number, name = 'Filler'): { card: ResolvedCard; quantity: number } => ({
  card: makeCard({ name, typeLine: 'Creature — Human', cmc: 3, manaCost: '{2}{G}', oracleText: '' }),
  quantity: n,
});

const lands = (n: number) => ({ card: basicLand('Forest', 'G'), quantity: n });
const one = (name: string) => ({ card: realCard(name), quantity: 1 });
const pad = (used: number) => filler(Math.max(0, 62 - used));

/**
 * A Reanimator shell. Used for the prevention/recovery comparisons because
 * Reanimator is an archetype with real recovery vocabulary — Tokens now has
 * none, so a Tokens deck cannot vary its Recovery score at all.
 */
const REANIMATOR_SHELL = [
  one('Reanimate'), one('Necromancy'), one('Bond of Revival'),
  one('Entomb'), one("Stitcher's Supplier"),
];

/** A Tokens shell: satisfies the archetype anchor without touching resilience. */
const TOKENS_SHELL = [
  one('Bitterblossom'), one('Cryptbreaker'), one('Academy Manufactor'),
  one('Dockside Extortionist'), one('Goldspan Dragon'), one('Impact Tremors'),
];

/** Protection package, no recovery whatsoever. */
const PROTECTION = [
  one("Teferi's Protection"), one('Heroic Intervention'), one('Lightning Greaves'),
  one('Swiftfoot Boots'), one('Snakeskin Veil'), one('Veil of Summer'),
];

export interface SyntheticResilienceDeck {
  id: string;
  description: string;
  composition: DeckComposition;
}

export const SYNTHETIC_RESILIENCE_DECKS: SyntheticResilienceDeck[] = [
  {
    id: 'glass-cannon',
    description: 'Reanimator plan with minimal protection and minimal recovery',
    composition: { commanders: [], mainboard: [...REANIMATOR_SHELL, pad(5), lands(37)] },
  },
  {
    id: 'protected-only',
    description: 'Same shell plus substantial protection, no added recovery',
    composition: {
      commanders: [],
      mainboard: [...REANIMATOR_SHELL, ...PROTECTION, pad(11), lands(37)],
    },
  },
  {
    id: 'recovery-only',
    description: 'Same shell plus on-plan graveyard recovery, no protection',
    composition: {
      commanders: [],
      mainboard: [
        ...REANIMATOR_SHELL,
        one('Regrowth'), one('Eternal Witness'), one('Timeless Witness'),
        one('Animate Dead'), one('Sun Titan'), one("Sevinne's Reclamation"),
        pad(11), lands(37),
      ],
    },
  },
  {
    id: 'protected-and-recovery',
    description: 'Both families present: must outperform either alone',
    composition: {
      commanders: [],
      mainboard: [
        ...REANIMATOR_SHELL, ...PROTECTION,
        one('Regrowth'), one('Eternal Witness'), one('Timeless Witness'),
        one('Animate Dead'), one('Sun Titan'), one("Sevinne's Reclamation"),
        pad(17), lands(37),
      ],
    },
  },
  {
    id: 'off-plan-recursion',
    description: 'Equal recursion volume in a Tokens deck, none of it on-plan',
    composition: {
      commanders: [],
      mainboard: [
        ...TOKENS_SHELL,
        one('Regrowth'), one('Eternal Witness'), one('Timeless Witness'),
        one('Reanimate'), one('Necromancy'), one('Bond of Revival'),
        pad(12), lands(37),
      ],
    },
  },
  {
    id: 'on-plan-recursion',
    description: 'The same six recursion cards where they ARE on-plan (Reanimator)',
    composition: {
      commanders: [],
      mainboard: [
        ...REANIMATOR_SHELL,
        one('Regrowth'), one('Eternal Witness'), one('Timeless Witness'),
        one('Animate Dead'), one('Persist'), one('Unearth'),
        pad(11), lands(37),
      ],
    },
  },
  {
    id: 'generators-no-recursion',
    description: 'Regression: many token generators, zero recursion — redundancy only',
    composition: {
      commanders: [],
      mainboard: [
        one('Bitterblossom'), one('Cryptbreaker'), one('Academy Manufactor'),
        one('Dockside Extortionist'), one('Goldspan Dragon'), one('Scute Swarm'),
        one('Impact Tremors'), one("Cathars' Crusade"), one('Intangible Virtue'),
        pad(9), lands(37),
      ],
    },
  },
  {
    id: 'high-redundancy-no-recursion',
    description: 'Deep support for every required function, nothing to recur',
    composition: {
      commanders: [],
      mainboard: [
        ...TOKENS_SHELL,
        one('Ashnod’s Altar'.replace('’', "'")), one("Cathars' Crusade"),
        one('Intangible Virtue'), one('Skullclamp'), one('Purphoros, God of the Forge'),
        one('Sai, Master Thopterist'), one('Myr Battlesphere'), one('Scute Swarm'),
        pad(14), lands(37),
      ],
    },
  },
  {
    id: 'thin-weakest-link',
    description: 'Many generators but a single payoff: one removal spell breaks it',
    composition: {
      commanders: [],
      mainboard: [
        one('Bitterblossom'), one('Cryptbreaker'), one('Academy Manufactor'),
        one('Dockside Extortionist'), one('Goldspan Dragon'), one('Scute Swarm'),
        one('Myr Battlesphere'), one('Hangarback Walker'),
        one('Impact Tremors'),
        pad(9), lands(37),
      ],
    },
  },
  {
    id: 'balanced-engine',
    description: 'Same total support, spread evenly across required functions',
    composition: {
      commanders: [],
      mainboard: [
        // 5 generators (meets the Tokens anchor) and 5 payoffs: same total
        // support as thin-weakest-link, spread evenly instead of lopsided.
        one('Bitterblossom'), one('Cryptbreaker'), one('Academy Manufactor'),
        one('Dockside Extortionist'), one('Goldspan Dragon'),
        one('Impact Tremors'), one("Cathars' Crusade"), one('Intangible Virtue'),
        one('Skullclamp'), one('Ashnod’s Altar'.replace('’', "'")),
        pad(10), lands(37),
      ],
    },
  },
  // --- commander backup progression -------------------------------------
  {
    id: 'commander-engine-zero-backup',
    description: 'Commander supplies token_payoff; no mainboard card shares it',
    composition: {
      commanders: [realCard('Purphoros, God of the Forge')],
      mainboard: [
        one('Bitterblossom'), one('Cryptbreaker'), one('Academy Manufactor'),
        one('Dockside Extortionist'), one('Goldspan Dragon'), one('Scute Swarm'),
        pad(6), lands(37),
      ],
    },
  },
  {
    id: 'commander-engine-one-backup',
    description: 'Same commander, exactly one mainboard token_payoff',
    composition: {
      commanders: [realCard('Purphoros, God of the Forge')],
      mainboard: [
        one('Bitterblossom'), one('Cryptbreaker'), one('Academy Manufactor'),
        one('Dockside Extortionist'), one('Goldspan Dragon'), one('Scute Swarm'),
        one('Impact Tremors'),
        pad(7), lands(37),
      ],
    },
  },
  {
    id: 'commander-engine-three-backups',
    description: 'Same commander, three mainboard token_payoff cards',
    composition: {
      commanders: [realCard('Purphoros, God of the Forge')],
      mainboard: [
        one('Bitterblossom'), one('Cryptbreaker'), one('Academy Manufactor'),
        one('Dockside Extortionist'), one('Goldspan Dragon'), one('Scute Swarm'),
        one('Impact Tremors'), one("Cathars' Crusade"), one('Intangible Virtue'),
        pad(9), lands(37),
      ],
    },
  },
  {
    id: 'commander-engine-two-backups',
    description: 'Same commander, two mainboard token_payoff cards',
    composition: {
      commanders: [realCard('Purphoros, God of the Forge')],
      mainboard: [
        one('Bitterblossom'), one('Cryptbreaker'), one('Academy Manufactor'),
        one('Dockside Extortionist'), one('Goldspan Dragon'), one('Scute Swarm'),
        one('Impact Tremors'), one("Cathars' Crusade"),
        pad(8), lands(37),
      ],
    },
  },
  {
    id: 'commander-engine-six-backups',
    description: 'Same commander, six mainboard token_payoff cards',
    composition: {
      commanders: [realCard('Purphoros, God of the Forge')],
      mainboard: [
        one('Bitterblossom'), one('Cryptbreaker'), one('Academy Manufactor'),
        one('Dockside Extortionist'), one('Goldspan Dragon'), one('Scute Swarm'),
        one('Impact Tremors'), one("Cathars' Crusade"), one('Intangible Virtue'),
        one('Skullclamp'), one('Ashnod’s Altar'.replace('’', "'")),
        one('Season of Growth'),
        pad(12), lands(37),
      ],
    },
  },
  {
    id: 'commander-not-relevant',
    description: 'Commander contributes no primary-plan tag, and none is expected',
    composition: {
      commanders: [realCard('Bruenor Battlehammer')],
      mainboard: [...TOKENS_SHELL, pad(6), lands(37)],
    },
  },
  {
    id: 'commander-unknown-evidence',
    description: 'Reanimator whose commander engine is invisible to Phase 3A tags',
    composition: {
      commanders: [realCard('Talrand, Sky Summoner')],
      mainboard: [
        one('Reanimate'), one('Necromancy'), one('Bond of Revival'),
        one('Persist'), one('Sun Titan'), one("Sevinne's Reclamation"),
        one('Entomb'), one("Stitcher's Supplier"),
        pad(8), lands(37),
      ],
    },
  },
  // --- archetype-specific recovery --------------------------------------
  {
    id: 'graveyard-recursion-plan',
    description: 'Reanimator whose recovery is squarely on-plan',
    composition: {
      commanders: [],
      mainboard: [
        one('Reanimate'), one('Necromancy'), one('Bond of Revival'), one('Persist'),
        one('Sun Titan'), one("Sevinne's Reclamation"), one('Regrowth'),
        one('Eternal Witness'), one('Animate Dead'),
        one('Entomb'), one("Stitcher's Supplier"),
        pad(11), lands(37),
      ],
    },
  },
  {
    id: 'lands-recursion-plan',
    description: 'Lands deck recovering its own primary resource',
    composition: {
      commanders: [realCard('Titania, Protector of Argoth')],
      mainboard: [
        one('Crucible of Worlds'), one('Ramunap Excavator'), one('Life from the Loam'),
        one('Splendid Reclamation'), one('Exploration'), one('Oracle of Mul Daya'),
        one('The Gitrog Monster'), one('Tireless Tracker'),
        pad(8), lands(37),
      ],
    },
  },
];
