import { frontFace } from './cardFacts';
import {
  COLOR_CODES,
  type ColorCode,
  type CommanderEligibility,
  type CommanderInfo,
  type DeckSection,
  type ResolvedCard,
  type ValidationIssue,
} from './types';

/**
 * Commander identification. Pure.
 *
 * Eligibility is NOT simply "Legendary Creature": Grist, the Hunger Tide is a
 * Legendary Planeswalker that qualifies only through its oracle text (verified
 * against the live API). Both rules are needed.
 */

/**
 * Cards that may be a commander by Commander rules-committee ruling, with
 * nothing in the Scryfall data to say so.
 *
 * Grist, the Hunger Tide is a Legendary Planeswalker whose text makes it a
 * creature only while off the battlefield; it prints no "can be your
 * commander" clause (verified against the live API), so no data-driven rule
 * catches it. Matched by oracle id, which is stable across printings.
 */
const ELIGIBLE_BY_RULING = new Set<string>([
  // Grist, the Hunger Tide
  '0efb0d7e-dea0-4817-a243-15066e9ef333',
]);

/** Names for the same exceptions, since oracle ids can drift in test data. */
const ELIGIBLE_BY_RULING_NAMES = new Set<string>(['grist, the hunger tide']);

function isEligibleByRuling(card: ResolvedCard): boolean {
  return (
    ELIGIBLE_BY_RULING.has(card.oracleId) ||
    ELIGIBLE_BY_RULING_NAMES.has(card.name.trim().toLowerCase())
  );
}

export function commanderEligibility(card: ResolvedCard): CommanderEligibility | null {
  const front = frontFace(card.typeLine);
  if (/\bLegendary\b/i.test(front) && /\bCreature\b/i.test(front)) {
    return 'legendary-creature';
  }
  // 32 cards print this clause (Aminatou, Estrid, Freyalise, ...).
  if (/can be your commander/i.test(card.oracleText)) {
    return 'can-be-your-commander';
  }
  if (isEligibleByRuling(card)) {
    return 'can-be-your-commander';
  }
  return null;
}

export function isCommanderEligible(card: ResolvedCard): boolean {
  return commanderEligibility(card) !== null;
}

/** Partner is exposed as a Scryfall keyword, so no oracle-text parsing. */
export function hasPartner(card: ResolvedCard): boolean {
  return card.keywords.some((k) => /^partner$/i.test(k));
}

/** "Partner with <name>" is a distinct, narrower ability. */
export function hasPartnerWith(card: ResolvedCard): boolean {
  return card.keywords.some((k) => /^partner with/i.test(k));
}

export function choosesBackground(card: ResolvedCard): boolean {
  return card.keywords.some((k) => /^choose a background$/i.test(k));
}

export function isBackground(card: ResolvedCard): boolean {
  return /\bBackground\b/i.test(frontFace(card.typeLine));
}

export function toCommanderInfo(card: ResolvedCard): CommanderInfo {
  return {
    scryfallId: card.scryfallId,
    name: card.name,
    colorIdentity: card.colorIdentity,
    eligibility: commanderEligibility(card) ?? 'legendary-creature',
    hasPartner: hasPartner(card) || hasPartnerWith(card),
    choosesBackground: choosesBackground(card),
    isBackground: isBackground(card),
  };
}

/** The union of the commanders' colour identities, in WUBRG order. */
export function combinedColorIdentity(commanders: ResolvedCard[]): ColorCode[] {
  const seen = new Set<ColorCode>();
  for (const c of commanders) for (const color of c.colorIdentity) seen.add(color);
  return COLOR_CODES.filter((c) => seen.has(c));
}

/**
 * Is this a legal pair of commanders? Partner + Partner, or a
 * "Choose a Background" commander paired with a Background.
 */
export function isLegalCommanderPair(a: ResolvedCard, b: ResolvedCard): boolean {
  if (hasPartner(a) && hasPartner(b)) return true;
  if (choosesBackground(a) && isBackground(b)) return true;
  if (choosesBackground(b) && isBackground(a)) return true;
  // "Partner with" names a specific other card, but Scryfall's keyword is
  // just "Partner with", so the specific pairing is not checked here.
  if (hasPartnerWith(a) && hasPartnerWith(b)) return true;
  return false;
}

export interface IdentifyCommandersInput {
  card: ResolvedCard;
  quantity: number;
  section: DeckSection;
}

export interface IdentifyCommandersResult {
  commanders: ResolvedCard[];
  /** Cards moved out of the mainboard because they are commanders. */
  commanderKeys: Set<string>;
  issues: ValidationIssue[];
}

/**
 * Pick the commander(s).
 *
 * Precedence: an explicit "commander" section wins. Otherwise infer the
 * eligible legendary from the mainboard, preferring the first line — the
 * community convention for a plain 100-line list.
 */
export function identifyCommanders(
  entries: IdentifyCommandersInput[],
): IdentifyCommandersResult {
  const issues: ValidationIssue[] = [];
  const tagged = entries.filter((e) => e.section === 'commander');

  if (tagged.length > 0) {
    const ineligible = tagged.filter((e) => !isCommanderEligible(e.card));
    for (const bad of ineligible) {
      issues.push({
        code: 'INVALID_COMMANDER',
        severity: 'error',
        message: `${bad.card.name} is listed as a commander but cannot be one.`,
        cardNames: [bad.card.name],
      });
    }
    const eligible = tagged.filter((e) => isCommanderEligible(e.card));
    const commanders = eligible.map((e) => e.card);

    if (commanders.length > 2) {
      issues.push({
        code: 'TOO_MANY_COMMANDERS',
        severity: 'error',
        message: `A deck may have at most two commanders; found ${commanders.length}.`,
        cardNames: commanders.map((c) => c.name),
      });
    } else if (commanders.length === 2) {
      const [a, b] = commanders as [ResolvedCard, ResolvedCard];
      if (!isLegalCommanderPair(a, b)) {
        issues.push({
          code: 'TOO_MANY_COMMANDERS',
          severity: 'error',
          message:
            `${a.name} and ${b.name} cannot be paired: ` +
            'two commanders require Partner or a Background.',
          cardNames: [a.name, b.name],
        });
      }
    }

    return {
      commanders,
      commanderKeys: new Set(commanders.map((c) => c.scryfallId)),
      issues,
    };
  }

  // No explicit section: infer from the mainboard, first eligible line wins.
  const inferred = entries.find((e) => isCommanderEligible(e.card));
  if (!inferred) {
    issues.push({
      code: 'NO_COMMANDER',
      severity: 'error',
      message:
        'No commander found. Add a "Commander:" line, or include a legendary creature.',
    });
    return { commanders: [], commanderKeys: new Set(), issues };
  }

  return {
    commanders: [inferred.card],
    commanderKeys: new Set([inferred.card.scryfallId]),
    issues,
  };
}
