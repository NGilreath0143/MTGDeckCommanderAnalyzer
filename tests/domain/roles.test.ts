import { describe, expect, it } from 'vitest';
import { analyzeDeckRoles, classifyCardRoles } from '@/domain/roles';
import { CARD_ROLES, type CardRole, type ResolvedCard } from '@/domain/types';
import { realCard } from '../fixtures/roleCards';
import { basicLand, legendaryCreature, makeCard } from '../fixtures/cards';

/**
 * This suite IS the semantic specification for card roles.
 *
 * Every card here uses real Oracle text captured from the live Scryfall API,
 * so a rule cannot pass by matching invented wording.
 */

const rolesOf = (name: string): CardRole[] => [
  ...new Set(classifyCardRoles(realCard(name)).assignments.map((a) => a.role)),
];

const expectRole = (name: string, role: CardRole) => {
  expect(rolesOf(name), `${name} should be ${role}`).toContain(role);
};
const expectNotRole = (name: string, role: CardRole) => {
  expect(rolesOf(name), `${name} should NOT be ${role}`).not.toContain(role);
};

// ---------------------------------------------------------------------------
// The hard negatives — written first, because these rules are the most likely
// to be subtly wrong and a regression here must be unambiguous.
// ---------------------------------------------------------------------------

describe('hard negatives', () => {
  it('Malakir Rebirth is protection, and neither ramp nor recursion', () => {
    // The combined oracle text contains the back face's "{T}: Add {B}." AND
    // "return it to the battlefield" from a granted death trigger. Both must
    // be invisible to their respective rules.
    const roles = rolesOf('Malakir Rebirth // Malakir Mire');
    expect(roles).toContain('protection');
    expect(roles).not.toContain('ramp');
    expect(roles).not.toContain('recursion');
  });

  it('Feign Death is protection, not recursion', () => {
    // Grants a death trigger pre-emptively rather than retrieving from a grave.
    expect(rolesOf('Feign Death')).toContain('protection');
    expect(rolesOf('Feign Death')).not.toContain('recursion');
  });

  it('Dryad Arbor is not ramp (its mana ability is reminder text only)', () => {
    expect(rolesOf('Dryad Arbor')).not.toContain('ramp');
  });

  it('Bojuka Bog is graveyard hate but not ramp (it is a land)', () => {
    expectRole('Bojuka Bog', 'graveyard_hate');
    expectNotRole('Bojuka Bog', 'ramp');
  });

  it.each(['Decimate', 'Hex'])('%s is interaction, not a board wipe', (name) => {
    expectRole(name, 'interaction');
    expectNotRole(name, 'board_wipe');
  });

  it.each(['Ponder', 'Opt', 'Preordain'])(
    '%s is card selection, not card advantage (1-for-1 cantrip)',
    (name) => {
      expectRole(name, 'card_selection');
      expectNotRole(name, 'card_advantage');
    },
  );

  it.each(['Cultivate', "Kodama's Reach", 'Expedition Map', 'Land Tax'])(
    '%s is ramp, not a tutor (land development)',
    (name) => {
      expectRole(name, 'ramp');
      expectNotRole(name, 'tutor');
    },
  );

  it.each(['Imprisoned in the Moon', 'Song of the Dryads'])(
    '%s is interaction, not ramp',
    (name) => {
      expectRole(name, 'interaction');
      expectNotRole(name, 'ramp');
    },
  );

  it('Darksteel Mutation is interaction, not protection', () => {
    // It grants indestructible to the VICTIM, not to your own board.
    expectRole('Darksteel Mutation', 'interaction');
    expectNotRole('Darksteel Mutation', 'protection');
  });

  it('Stifle is interaction only (it counters an ability, not a spell)', () => {
    expectRole('Stifle', 'interaction');
    expectNotRole('Stifle', 'protection');
  });

  it.each(["Yawgmoth's Will", 'Underworld Breach'])(
    '%s is recursion, not graveyard hate (it exiles from YOUR graveyard as a cost)',
    (name) => {
      expectRole(name, 'recursion');
      expectNotRole(name, 'graveyard_hate');
    },
  );

  it('Rest in Peace is graveyard hate, not a board wipe', () => {
    // "Exile all graveyards" must not read as mass permanent removal.
    expectRole('Rest in Peace', 'graveyard_hate');
    expectNotRole('Rest in Peace', 'board_wipe');
  });

  it.each(["Tormod's Crypt", 'Scavenging Ooze'])(
    '%s is graveyard hate, not interaction',
    (name) => {
      expectRole(name, 'graveyard_hate');
      expectNotRole(name, 'interaction');
    },
  );

  it('a land whose mana ability riders a scry is not card selection', () => {
    // Path of Ancestry: the scry is conditional on how its mana is spent.
    const card = makeCard({
      name: 'Path of Ancestry',
      typeLine: 'Land',
      oracleText:
        'This land enters tapped.\n{T}: Add one mana of any color in your ' +
        "commander's color identity. When that mana is spent to cast a creature " +
        'spell that shares a creature type with your commander, scry 1.',
    });
    expect(classifyCardRoles(card).assignments).toEqual([]);
  });

  it.each(['Faithless Looting', 'Wheel of Fortune'])(
    '%s is not card advantage (no net gain)',
    (name) => {
      expectNotRole(name, 'card_advantage');
    },
  );

  it.each(['Act of Treason', 'Thoughtseize'])(
    '%s gets no interaction role (theft and hand disruption are out of taxonomy)',
    (name) => {
      expectNotRole(name, 'interaction');
    },
  );
});

// ---------------------------------------------------------------------------
// Multi-role: no role precedence may suppress another valid role.
// ---------------------------------------------------------------------------

describe('multi-role overlap', () => {
  it.each<[string, CardRole[]]>([
    ['Brainstorm', ['card_advantage', 'card_selection']],
    ['Counterspell', ['interaction', 'protection']],
    ['Cyclonic Rift', ['interaction', 'board_wipe']],
    ['Farewell', ['board_wipe', 'graveyard_hate']],
    ['Living Death', ['board_wipe', 'recursion']],
  ])('%s fills %j', (name, expected) => {
    const roles = rolesOf(name);
    for (const role of expected) expect(roles).toContain(role);
  });

  it('Deathrite Shaman is both graveyard hate and ramp', () => {
    // It exiles from graveyards AND adds mana of any color.
    const roles = rolesOf('Deathrite Shaman');
    expect(roles).toContain('graveyard_hate');
    expect(roles).toContain('ramp');
  });

  it('Vandalblast is interaction (base mode) and board wipe (overload)', () => {
    const roles = rolesOf('Vandalblast');
    expect(roles).toContain('interaction');
    expect(roles).toContain('board_wipe');
  });

  it('Living Death is not graveyard hate despite exiling graveyards', () => {
    expectNotRole('Living Death', 'graveyard_hate');
  });
});

// ---------------------------------------------------------------------------
// Positive coverage, per role.
// ---------------------------------------------------------------------------

describe('ramp', () => {
  it.each([
    'Sol Ring', 'Arcane Signet', 'Birds of Paradise', 'Talisman of Progress',
    'Cultivate', "Kodama's Reach", 'Dark Ritual', 'Dockside Extortionist',
    'Smothering Tithe', 'Land Tax', 'Expedition Map',
  ])('%s is ramp', (name) => expectRole(name, 'ramp'));
});

describe('card_advantage', () => {
  it.each([
    'Mystic Remora', 'Rhystic Study', 'Skullclamp', 'Light Up the Stage',
    'Brainstorm', 'Divination', 'Guardian Project', 'Beast Whisperer',
    'Sylvan Library',
  ])('%s is card advantage', (name) => expectRole(name, 'card_advantage'));
});

describe('card_selection', () => {
  it.each([
    'Ponder', 'Preordain', 'Brainstorm', 'Faithless Looting', 'Opt',
    'Impulse', "Sensei's Divining Top",
  ])('%s is card selection', (name) => expectRole(name, 'card_selection'));

  it.each(['Demonic Tutor', 'Vampiric Tutor', 'Worldly Tutor'])(
    '%s is excluded from card selection (tutors are separate)',
    (name) => expectNotRole(name, 'card_selection'),
  );
});

describe('tutor', () => {
  it.each([
    'Demonic Tutor', 'Vampiric Tutor', 'Worldly Tutor', 'Enlightened Tutor',
    "Green Sun's Zenith", 'Chord of Calling', 'Gamble', 'Diabolic Intent',
    'Birthing Pod', 'Solve the Equation',
  ])('%s is a tutor', (name) => expectRole(name, 'tutor'));
});

describe('interaction', () => {
  it.each([
    'Swords to Plowshares', 'Beast Within', 'Counterspell', 'Swan Song',
    'Cyclonic Rift', 'Imprisoned in the Moon', 'Darksteel Mutation',
    'Song of the Dryads', 'Unsummon', 'Stifle',
  ])('%s is interaction', (name) => expectRole(name, 'interaction'));
});

describe('board_wipe', () => {
  it.each([
    'Wrath of God', 'Farewell', 'Cyclonic Rift', 'Vandalblast',
    'Blasphemous Act', 'Toxic Deluge', 'Austere Command', 'Pyroclasm',
    'By Invitation Only', "Ezuri's Predation",
  ])('%s is a board wipe', (name) => expectRole(name, 'board_wipe'));
});

describe('protection', () => {
  it.each([
    'Heroic Intervention', "Teferi's Protection", 'Lightning Greaves',
    'Swiftfoot Boots', "Tamiyo's Safekeeping", 'Ephemerate', 'Cloudshift',
    'Malakir Rebirth // Malakir Mire', 'Feign Death', 'Selfless Spirit',
    'Mother of Runes', 'Deflecting Swat', 'Veil of Summer', 'Counterspell',
  ])('%s is protection', (name) => expectRole(name, 'protection'));
});

describe('recursion', () => {
  it.each([
    'Regrowth', 'Eternal Witness', 'Reanimate', 'Animate Dead', 'Sun Titan',
    "Sevinne's Reclamation", 'Snapcaster Mage', 'Past in Flames',
    'Underworld Breach', "Yawgmoth's Will", 'Living Death', 'Unearth',
  ])('%s is recursion', (name) => expectRole(name, 'recursion'));

  it('detects self-recursion from the Flashback keyword', () => {
    const card = makeCard({ keywords: ['Flashback'], oracleText: 'Draw a card.' });
    expect(classifyCardRoles(card).assignments.map((a) => a.role)).toContain('recursion');
  });

  it('detects self-recursion from the Escape keyword', () => {
    const card = makeCard({ keywords: ['Escape'], typeLine: 'Creature — Giant' });
    expect(classifyCardRoles(card).assignments.map((a) => a.role)).toContain('recursion');
  });
});

describe('graveyard_hate', () => {
  it.each([
    'Bojuka Bog', 'Rest in Peace', 'Soul-Guide Lantern', 'Scavenging Ooze',
    'Deathrite Shaman', 'Nihil Spellbomb', "Grafdigger's Cage",
    'Dauthi Voidwalker', 'Leyline of the Void', 'Farewell', "Tormod's Crypt",
    'Surgical Extraction', 'Ground Seal',
  ])('%s is graveyard hate', (name) => expectRole(name, 'graveyard_hate'));

  it('classifies Containment Priest via the documented exception list', () => {
    // Verified against the live API: its oracle text contains no "graveyard"
    // at all, so no text rule can reach it.
    const card = realCard('Containment Priest');
    expect(card.oracleText).not.toMatch(/graveyard/i);
    const assignments = classifyCardRoles(card).assignments;
    expect(assignments).toEqual(
      expect.arrayContaining([
        { role: 'graveyard_hate', ruleId: 'known-role-exception' },
      ]),
    );
  });
});

// ---------------------------------------------------------------------------
// Cards that should get no roles at all — guards against broad regexes.
// ---------------------------------------------------------------------------

describe('cards with no functional role', () => {
  it.each<[string, ResolvedCard]>([
    ['a vanilla creature', makeCard({ typeLine: 'Creature — Bear', oracleText: '' })],
    ['a basic land', basicLand('Forest', 'G')],
    [
      'plain damage',
      makeCard({
        typeLine: 'Instant',
        oracleText: 'Lightning Bolt deals 3 damage to any target.',
      }),
    ],
    [
      'a mana land',
      makeCard({
        typeLine: 'Land',
        oracleText: "{T}: Add one mana of any color in your commander's color identity.",
      }),
    ],
  ])('%s gets no roles', (_label, card) => {
    expect(classifyCardRoles(card).assignments).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Rule provenance.
// ---------------------------------------------------------------------------

describe('rule provenance', () => {
  it('reports scryfallId as cardId', () => {
    const card = realCard('Sol Ring');
    expect(classifyCardRoles(card).cardId).toBe(card.scryfallId);
  });

  it('gives every assignment a non-empty kebab-case ruleId', () => {
    for (const name of ['Sol Ring', 'Farewell', 'Counterspell', 'Living Death']) {
      for (const a of classifyCardRoles(realCard(name)).assignments) {
        expect(a.ruleId).toMatch(/^[a-z][a-z0-9-]*$/);
      }
    }
  });

  it('names the specific rule responsible', () => {
    const assignments = classifyCardRoles(realCard('Sol Ring')).assignments;
    expect(assignments).toEqual([{ role: 'ramp', ruleId: 'mana-ability' }]);
  });

  it('reports the overload mass-effect rule as the reason Vandalblast is a wipe', () => {
    const assignments = classifyCardRoles(realCard('Vandalblast')).assignments;
    expect(assignments).toEqual(
      expect.arrayContaining([{ role: 'board_wipe', ruleId: 'overload-mass-effect' }]),
    );
  });

  it('does not treat a self-buff overload spell as a board wipe', () => {
    // Mizzium Skin overloads into "each creature YOU control gains hexproof",
    // which sweeps nothing.
    const mizziumSkin = makeCard({
      name: 'Mizzium Skin',
      typeLine: 'Instant',
      keywords: ['Overload'],
      oracleText:
        'Target creature you control gets +0/+1 and gains hexproof until end of turn.\n' +
        'Overload {1}{U}',
    });
    const roles = classifyCardRoles(mizziumSkin).assignments.map((a) => a.role);
    expect(roles).not.toContain('board_wipe');
    expect(roles).toContain('protection');
  });

  it('never emits duplicate role+ruleId pairs', () => {
    for (const name of ['Farewell', 'Austere Command', 'Deathrite Shaman']) {
      const pairs = classifyCardRoles(realCard(name)).assignments.map(
        (a) => `${a.role}:${a.ruleId}`,
      );
      expect(new Set(pairs).size).toBe(pairs.length);
    }
  });
});

// ---------------------------------------------------------------------------
// Deck aggregation.
// ---------------------------------------------------------------------------

describe('analyzeDeckRoles', () => {
  const solRing = realCard('Sol Ring');
  const commander = legendaryCreature('Test Commander', ['W', 'U']);

  it('always includes every role key', () => {
    const profile = analyzeDeckRoles({ commanders: [], mainboard: [] });
    expect(Object.keys(profile.counts).sort()).toEqual([...CARD_ROLES].sort());
    expect(Object.keys(profile.cardsByRole).sort()).toEqual([...CARD_ROLES].sort());
    for (const role of CARD_ROLES) {
      expect(profile.counts[role]).toBe(0);
      expect(profile.cardsByRole[role]).toEqual([]);
    }
  });

  it('weights counts by quantity while listing the name once', () => {
    const profile = analyzeDeckRoles({
      commanders: [],
      mainboard: [{ card: solRing, quantity: 4 }],
    });
    expect(profile.counts.ramp).toBe(4);
    expect(profile.cardsByRole.ramp).toEqual(['Sol Ring']);
  });

  it('classifies commanders, since they are part of the 100', () => {
    const ramper = makeCard({
      name: 'Ramp Commander',
      typeLine: 'Legendary Creature — Elf Druid',
      oracleText: '{T}: Add one mana of any color.',
    });
    const profile = analyzeDeckRoles({ commanders: [ramper], mainboard: [] });
    expect(profile.counts.ramp).toBe(1);
    expect(profile.cardsByRole.ramp).toEqual(['Ramp Commander']);
  });

  it('lists commanders before mainboard cards', () => {
    const profile = analyzeDeckRoles({
      commanders: [realCard('Deathrite Shaman')],
      mainboard: [{ card: solRing, quantity: 1 }],
    });
    expect(profile.cardsByRole.ramp).toEqual(['Deathrite Shaman', 'Sol Ring']);
  });

  it('counts a multi-role card toward each of its roles', () => {
    const profile = analyzeDeckRoles({
      commanders: [],
      mainboard: [{ card: realCard('Farewell'), quantity: 1 }],
    });
    expect(profile.counts.board_wipe).toBe(1);
    expect(profile.counts.graveyard_hate).toBe(1);
  });

  it('counts a card once per role even when two rules fire for that role', () => {
    // Austere Command matches mass-removal on several bullets.
    const profile = analyzeDeckRoles({
      commanders: [],
      mainboard: [{ card: realCard('Austere Command'), quantity: 1 }],
    });
    expect(profile.counts.board_wipe).toBe(1);
  });

  it('does not require role totals to sum to the deck size', () => {
    const profile = analyzeDeckRoles({
      commanders: [commander],
      mainboard: [
        { card: solRing, quantity: 1 },
        { card: basicLand('Forest', 'G'), quantity: 37 },
      ],
    });
    const total = Object.values(profile.counts).reduce((a, b) => a + b, 0);
    expect(total).toBeLessThan(39);
  });

  it('ignores cards with no roles', () => {
    const profile = analyzeDeckRoles({
      commanders: [],
      mainboard: [{ card: basicLand('Forest', 'G'), quantity: 37 }],
    });
    for (const role of CARD_ROLES) expect(profile.counts[role]).toBe(0);
  });
});
