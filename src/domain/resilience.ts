import { classifyCardRoles } from './roles';
import { classifyCardTags } from './tags';
import { analyzeCardPower } from './powerCards';
import { scoreConsistency } from './consistency';
import type { DeckPowerEvidence } from './powerEvidence';
import type {
  ArchetypeInferenceType,
  CardTag,
  DeckArchetypeProfile,
  DeckComposition,
  ResolvedCard,
} from './types';

/**
 * Phase 4B.4 — the RESILIENCE power dimension. Pure.
 *
 * Answers "how well can this deck continue executing its game plan after
 * opponents disrupt it?"
 *
 * Deliberately distinct from Consistency, which asks whether the plan can be
 * FOUND and reproduced. A glass cannon can be highly consistent and barely
 * resilient; a slow recursive deck can be the reverse.
 *
 * Two conceptually separate families, never collapsed into one count:
 *   prevention — disruption fails to dismantle the plan (protection)
 *   recovery   — disruption succeeds, and the deck rebuilds
 *
 * Consumes Phase 4A evidence and Phase 3A tags. Introduces no Oracle-text
 * classification: the one structure defined here is a declarative map from
 * archetype to the tags whose cards genuinely restore that archetype's
 * resources, which is a scoring question rather than a classification one.
 */

export type ResilienceRating = 'low' | 'moderate' | 'good' | 'high' | 'elite';

/**
 * Whether commander backup could be determined at all.
 *
 * `unknown` exists because Phase 3A's vocabulary does not represent
 * permission-style recursion: Muldrotha matches zero primary-support tags
 * while being a textbook always-available engine. Scoring that as
 * `not_applicable` would silently penalise a known evidence gap, and scoring
 * it as average would silently reward one. It scores 0 and says so.
 */
export type CommanderBackupStatus = 'applicable' | 'not_applicable' | 'unknown';

export interface ResilienceComponent {
  score: number;
  max: number;
  raw: Record<string, number | boolean | string>;
}

export interface RequiredFunctionSupport {
  id: string;
  support: number;
}

export interface RedundancyDetail extends ResilienceComponent {
  functions: RequiredFunctionSupport[];
  minimumSupport: number;
}

export interface RecoveryDetail extends ResilienceComponent {
  relevantCards: string[];
  genericCards: string[];
}

export interface CommanderBackupDetail extends ResilienceComponent {
  status: CommanderBackupStatus;
  commanderPrimaryTags: CardTag[];
  backupByTag: Record<string, number>;
  minimumBackup: number;
}

export interface ResilienceDimension {
  score: number;
  rating: ResilienceRating;
  protection: ResilienceComponent;
  recovery: RecoveryDetail;
  redundancy: RedundancyDetail;
  commanderBackup: CommanderBackupDetail;
  limitations: string[];
}

// ---------------------------------------------------------------------------
// Recovery / rebuild relevance
// ---------------------------------------------------------------------------

/**
 * Which tags represent RESTORING or REBUILDING an archetype's primary
 * resource after disruption.
 *
 * Deliberately restricted to ACTUAL restoration or reuse of lost resources.
 * Generation tags (token_generation, artifact_generation, and similar) were
 * evaluated and removed: making a fresh token is not recovering a lost one,
 * and that capability is already measured by Weakest-Link Engine Redundancy.
 * Counting it here credited the same engine cards twice.
 *
 * Local to Resilience and deliberately NOT PRIMARY_SUPPORT_TAGS, which is a
 * support vocabulary load-bearing for win-condition alignment and Speed's
 * alignment score. Editing that to serve this dimension moves the others.
 *
 * Empty means no recovery vocabulary exists yet for the archetype. Voltron,
 * counters and proliferate have no tag expressing "rebuild the plan", so they
 * score zero recovery by construction — reported as a limitation rather than
 * approximated.
 */
const RECOVERY_RELEVANCE: Partial<Record<ArchetypeInferenceType, CardTag[]>> = {
  reanimator: ['graveyard_recursion', 'reanimation'],
  lands: ['land_recursion', 'graveyard_recursion'],
  landfall: ['land_recursion'],
  spellslinger: ['spell_recursion'],
  aristocrats: ['reanimation'],
  // No recovery vocabulary: these archetypes rebuild by generating fresh
  // resources rather than restoring lost ones, which Weakest-Link Engine
  // Redundancy already measures. Recovery is legitimately 0 for them, and a
  // deck can still be resilient through Protection and Redundancy.
  artifacts: [],
  tokens: [],
  go_wide: [],
  enchantress: [],
  aura_voltron: [],
  superfriends: [],
  voltron: [],
  counters: [],
  proliferate: [],
};

/**
 * Tags that make a card count as GENERIC recovery — recovering something,
 * just not necessarily this deck's plan.
 *
 * On-plan relevance is decided by RECOVERY_RELEVANCE instead, and a card
 * matching its archetype's rebuild vocabulary qualifies WITHOUT needing to be
 * recursion at all. That is the point of calling the component "recovery or
 * rebuild": a swept Tokens deck rebuilds by making more tokens, and its
 * generators are its recovery even though nothing returns from a graveyard.
 */
const GENERIC_RECOVERY_TAGS: readonly CardTag[] = [
  'reanimation',
  'land_recursion',
  'spell_recursion',
  'graveyard_recursion',
];

// ---------------------------------------------------------------------------
// Weights and maxima
// ---------------------------------------------------------------------------

const RECOVERY_MAX = 35;
const PROTECTION_MAX = 25;
const REDUNDANCY_MAX = 25;
const COMMANDER_BACKUP_MAX = 15;

/** Off-plan recovery still has incidental value, but far less. */
const GENERIC_RECOVERY_WEIGHT = 0.25;

const WEIGHT_EFFICIENT_PROTECTION = 2.0;
const WEIGHT_ORDINARY_PROTECTION = 1.0;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round2 = (n: number) => Math.round(n * 100) / 100;
const sat = (value: number, scale: number) =>
  value <= 0 ? 0 : 1 - Math.exp(-value / scale);

export function ratingFor(score: number): ResilienceRating {
  if (score < 25) return 'low';
  if (score < 45) return 'moderate';
  if (score < 65) return 'good';
  if (score < 80) return 'high';
  return 'elite';
}

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

interface Slot {
  card: ResolvedCard;
  quantity: number;
  roles: Set<string>;
  tags: Set<CardTag>;
  efficientProtection: boolean;
}

function slotsOf(composition: DeckComposition): Slot[] {
  const build = (card: ResolvedCard, quantity: number): Slot => ({
    card,
    quantity,
    roles: new Set(classifyCardRoles(card).assignments.map((a) => a.role)),
    tags: new Set(classifyCardTags(card).assignments.map((a) => a.tag)),
    efficientProtection: analyzeCardPower(card).assignments.some(
      (a) => a.property === 'efficient_protection',
    ),
  });
  return [
    ...composition.commanders.map((c) => build(c, 1)),
    ...composition.mainboard.map((m) => build(m.card, m.quantity)),
  ];
}

const total = (slots: Slot[], pred: (s: Slot) => boolean) =>
  slots.reduce((n, s) => (pred(s) ? n + s.quantity : n), 0);

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/**
 * Prevention: the deck stops disruption from resolving against its plan.
 * A card counted as efficient protection is never also counted as ordinary,
 * so one physical card contributes once at its stronger tier.
 */
function scoreProtection(slots: Slot[]): ResilienceComponent {
  const efficient = total(slots, (s) => s.roles.has('protection') && s.efficientProtection);
  const ordinary = total(slots, (s) => s.roles.has('protection') && !s.efficientProtection);

  const pool = WEIGHT_EFFICIENT_PROTECTION * efficient + WEIGHT_ORDINARY_PROTECTION * ordinary;
  return {
    score: PROTECTION_MAX * sat(pool, 6),
    max: PROTECTION_MAX,
    raw: {
      totalProtection: efficient + ordinary,
      efficientProtection: efficient,
      ordinaryProtection: ordinary,
      weightedPool: round2(pool),
    },
  };
}

/**
 * Recovery / rebuild: the deck re-establishes its plan after disruption lands.
 *
 * Relevance is archetype-scoped. A land-recursion package makes a Lands deck
 * resilient; the same package does nothing for a Spellslinger plan. Off-plan
 * recovery keeps a small share rather than none, since recovering ANY card has
 * some incidental value.
 */
function scoreRecovery(
  slots: Slot[],
  primary: ArchetypeInferenceType | null,
): RecoveryDetail {
  const vocabulary = primary ? (RECOVERY_RELEVANCE[primary] ?? []) : [];

  let relevant = 0;
  let generic = 0;
  const relevantCards: string[] = [];
  const genericCards: string[] = [];

  for (const s of slots) {
    /*
     * On-plan first: a card carrying the archetype's recovery vocabulary is
     * relevant recovery. The bare Phase 2 `recursion` role is never
     * sufficient for relevance on its own.
     */
    if (vocabulary.some((t) => s.tags.has(t))) {
      relevant += s.quantity;
      relevantCards.push(s.card.name);
      continue;
    }
    // Otherwise it counts only if it recovers SOMETHING, at a reduced share.
    const recoversSomething =
      s.roles.has('recursion') || GENERIC_RECOVERY_TAGS.some((t) => s.tags.has(t));
    if (!recoversSomething) continue;
    generic += s.quantity;
    genericCards.push(s.card.name);
  }

  const pool = relevant + GENERIC_RECOVERY_WEIGHT * generic;
  return {
    score: RECOVERY_MAX * sat(pool, 6),
    max: RECOVERY_MAX,
    relevantCards,
    genericCards,
    raw: {
      primaryArchetype: primary ?? '(none)',
      vocabulary: vocabulary.join(',') || '(none defined)',
      relevant,
      generic,
      weightedPool: round2(pool),
    },
  };
}

/**
 * Weakest-link engine redundancy.
 *
 * Reuses Consistency's per-function support but reads the MINIMUM rather than
 * the mean. Consistency asks "can I assemble this?"; Resilience asks "what
 * happens when they kill the weakest link?" Two decks can share a mean of 5.0
 * while one has a function supported by a single card — a point of failure the
 * mean hides completely.
 */
function scoreRedundancy(
  composition: DeckComposition,
  evidence: DeckPowerEvidence,
  archetypes: DeckArchetypeProfile,
): RedundancyDetail {
  const consistency = scoreConsistency(composition, evidence, archetypes);
  const functions = consistency.redundancy.functions
    .filter((f) => f.kind === 'required')
    .map((f) => ({ id: f.id, support: f.support }));

  const minimumSupport =
    functions.length === 0 ? 0 : Math.min(...functions.map((f) => f.support));

  return {
    score: REDUNDANCY_MAX * sat(minimumSupport, 3),
    max: REDUNDANCY_MAX,
    functions,
    minimumSupport,
    raw: {
      requiredFunctions: functions.length,
      supports: functions.map((f) => `${f.id}=${f.support}`).join(' ') || '(none)',
      minimumSupport,
    },
  };
}

/**
 * Commander backup.
 *
 * Measures two things existing evidence supports — whether the commander
 * contributes to the primary plan, and whether mainboard pieces carry the same
 * function — and deliberately NOT commander dependence, which is not derivable
 * (see the CommanderBackupStatus note).
 *
 * Per-tag minimum rather than a lumped count: spellslinger's commander supplies
 * spell_payoff (9 backups) and spell_cost_reduction (2), and the weaker of the
 * two is what breaks first.
 */
function scoreCommanderBackup(
  composition: DeckComposition,
  slots: Slot[],
  evidence: DeckPowerEvidence,
): CommanderBackupDetail {
  const commanderTags = evidence.commanderEngine.commanderPrimaryTags;
  const hasCommander = composition.commanders.length > 0;

  const mainboardSlots = slots.slice(composition.commanders.length);
  const backupByTag: Record<string, number> = {};
  for (const tag of commanderTags) {
    backupByTag[tag] = total(mainboardSlots, (s) => s.tags.has(tag));
  }

  let status: CommanderBackupStatus;
  if (commanderTags.length > 0) {
    status = 'applicable';
  } else if (!hasCommander) {
    status = 'not_applicable';
  } else {
    /*
     * A commander exists but matches no primary-plan tag. That is either a
     * genuine non-contributor or a vocabulary gap (Muldrotha). Existing
     * evidence cannot tell the two apart, so the result is unknown rather
     * than a confident zero.
     */
    status = 'unknown';
  }

  const minimumBackup =
    commanderTags.length === 0 ? 0 : Math.min(...commanderTags.map((t) => backupByTag[t] ?? 0));

  /*
   * Actual backup only, with no command-zone floor. Availability from the
   * command zone is a CONSISTENCY property — the commander can always be
   * accessed — not a resilience one: it says nothing about continuing after
   * the commander is answered. A floor also paid an incidental primary-tag
   * commander exactly what it paid a genuine engine, since neither can be
   * distinguished from the other with existing evidence.
   */
  const score = status === 'applicable' ? COMMANDER_BACKUP_MAX * sat(minimumBackup, 2) : 0;

  return {
    score,
    max: COMMANDER_BACKUP_MAX,
    status,
    commanderPrimaryTags: commanderTags,
    backupByTag,
    minimumBackup,
    raw: {
      status,
      commanderPrimaryTags: commanderTags.join(',') || '(none)',
      backupByTag:
        Object.entries(backupByTag).map(([t, n]) => `${t}=${n}`).join(' ') || '(none)',
      minimumBackup,
      scoreAvailable: status === 'applicable',
    },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function collectLimitations(
  recovery: RecoveryDetail,
  commander: CommanderBackupDetail,
  primary: ArchetypeInferenceType | null,
): string[] {
  const limitations: string[] = [];

  if (commander.status === 'unknown') {
    limitations.push(
      'commander backup is UNAVAILABLE, not zero: the commander matches no primary-plan ' +
        'tag, which existing evidence cannot distinguish from a Phase 3A vocabulary gap ' +
        '(permission-style recursion such as Muldrotha)',
    );
  }
  if (primary && (RECOVERY_RELEVANCE[primary] ?? []).length === 0) {
    limitations.push(
      `no recovery vocabulary exists for the ${primary} archetype, so its rebuild ` +
        'capability scores zero by construction rather than by measurement',
    );
  }
  if (primary === null) {
    limitations.push('no primary archetype established, so no recovery is on-plan');
  }

  /*
   * Always disclosed: properties of the model itself rather than of any
   * particular deck, so they must not be conditional on the evidence.
   */
  limitations.push(
    'commander DEPENDENCE is not measured: existing evidence shows contribution and ' +
      'backup, never whether the plan can execute without the commander',
  );
  limitations.push(
    'commander backup counts tag-level alternatives, not true functional ' +
      'substitutability: a card sharing a tag may not actually replace the commander',
  );
  limitations.push(
    'protection does not distinguish hexproof, indestructible, ward, or one-shot ' +
      'versus static effects; Phase 2 exposes a single protection role',
  );
  limitations.push(
    'no evidence expresses rebuilding specifically after a board wipe, as opposed to ' +
      'recovering from targeted disruption',
  );
  return limitations;
}

/**
 * Score the RESILIENCE dimension.
 *
 * Components sum to 100: recovery 35, protection 25, weakest-link redundancy
 * 25, commander backup 15.
 */
export function scoreResilience(
  composition: DeckComposition,
  evidence: DeckPowerEvidence,
  archetypes: DeckArchetypeProfile,
): ResilienceDimension {
  const slots = slotsOf(composition);
  const primary =
    archetypes.inferences
      .filter((i) => i.anchorSatisfied)
      .sort((a, b) => b.score - a.score)[0]?.archetype ?? null;

  const protection = scoreProtection(slots);
  const recovery = scoreRecovery(slots, primary);
  const redundancy = scoreRedundancy(composition, evidence, archetypes);
  const commanderBackup = scoreCommanderBackup(composition, slots, evidence);

  const score = clamp(
    recovery.score + protection.score + redundancy.score + commanderBackup.score,
    0,
    100,
  );

  return {
    score: round2(score),
    rating: ratingFor(score),
    protection: { ...protection, score: round2(protection.score) },
    recovery: { ...recovery, score: round2(recovery.score) },
    redundancy: { ...redundancy, score: round2(redundancy.score) },
    commanderBackup: { ...commanderBackup, score: round2(commanderBackup.score) },
    limitations: collectLimitations(recovery, commanderBackup, primary),
  };
}
