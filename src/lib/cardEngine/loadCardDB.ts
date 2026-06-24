/**
 * loadCardDB.ts — runtime loader for cardDB.json (built from WhatIff_CardDB_v8.xlsx).
 *
 * Parses the JSON into the EXACT typed structures computeEarn.ts and rankCards.ts consume,
 * and validates the data on load so a malformed DB fails loudly at startup, not silently at
 * runtime (the "silent zero" class of bug). Pure parsing — no math, no I/O beyond the supplied JSON.
 */

import type { EarnRow, SpendCategory, CapPeriod, RowType } from './computeEarn';
import type {
  CardMeta, CategoryStrength, LoungeStructured, MovieStructured,
} from './rankCards';

// ── Raw JSON shapes (as emitted by build_card_db.py) ─────────────────────────
interface RawCard {
  cardId: string; name: string; bank: string | null; feeTier: string | null;
  network: string | null; cibilScore: number | null; minSalary: number; minItr: number;
  joiningFee: number; annualFee: number; feeWaiverSpend: number; forexPct: number;
  loungeAccess: string | null; loungeDetail: string | null; inviteOnly: boolean;
  aprAnnualPct: number | null; interestFreeDaysRetail: number | null;
  emiConversionAprPct: number | null; cashAdvanceFee: string | null;
  pros: string | null; cons: string | null; tips: string | null;
  loungeStructured?: LoungeStructured | null;
  movieStructured?: MovieStructured | null;
  redemption?: Redemption;
}

export interface RedemptionMethod {
  channel: string;
  valuePerPoint: number | null;
  valueRange: [number, number] | null;
  valueIsVariable: boolean;
  minPoints: number | null;
  feePerRedemption: number | null;
  capPerCycle: number | null;
  best?: string;
  worst?: string;
  note?: string;
}

export interface Redemption {
  currency: 'points' | 'cashback-points' | 'cashback' | 'miles';
  currencyName: string;
  plainSummary: string;
  methods: RedemptionMethod[];
  caps?: string | null;
  fees?: string | null;
}
interface RawEarn {
  cardId: string; ladderId: string | null; category: string; rowType: string;
  earnNum: number | null; earnPer: number | null; rewardUnit: string;
  redemptionRoute: string; redeemValue: number | null; trigger: string | null;
  thresholdAmount: number | null; thresholdPeriod: string | null;
  stacks: boolean; excluded: boolean; capAmount: number | null; capPeriod: string | null;
  sharedCapId: string | null; multiplierNote: string | null; sourceNote: string;
}
interface RawLadder {
  cardId: string; ladderId: string | null; rewardUnit: string; rungName: string;
  valuePerPoint: number | null; route: string; isCommonUseDefault: boolean;
}
interface RawStrength {
  cardId: string; Online: number | null; Travel: number | null; Dining: number | null;
  Fuel: number | null; Grocery: number | null; International: number | null;
  Overall: number | null; bestFor: string | null;
}
export interface Warning {
  warningId: string; changeType: string | null; affectedCardIds: string | null;
  affectedHackIds: string | null; changeDate: string | null; whatChanged: string | null;
  whatUserShouldKnow: string | null; replacement: string | null; severity: string | null;
  triggerWhen: string | null;
}
export interface Hack {
  hackId: string; cardId: string; hackName: string | null; executionSteps: string | null;
  whyItMatters: string | null; relevantCategories: string | null; minMonthlySpend: number | null;
  platformRequired: string | null; priorityMatch: string | null; rateWithHack: number | null;
  rateWithoutHack: number | null; monthlyCap: number | null; status: string | null;
  statusNote?: string | null; commonFailure?: string | null; difficulty?: string | null;
  lastVerified?: string | null; sources?: string | null;
  relatedWarnings: string | null;
}
export interface Insight {
  insightId: string; topic: string | null; description: string | null; relevance: string | null;
  triggerConditions: string | null; relatedCardIds: string | null; engineNote: string | null;
}
export interface CardIntel {
  intelId: string; cardId: string; type: string | null; title: string | null;
  description: string | null; severity: string | null; source: string | null;
}
export interface TransferHack {
  cardId: string; flightHack: string; hotelHack: string;
  transferAsOf: string; displayTravelHack: boolean;
  honestyStatus: string; attachedWarnings: string[];
}
export interface TransferPartner {
  cardId: string; partner: string; type: string; ratio: string; notes: string | null;
}
interface RawDB {
  version: string; cards: RawCard[]; earnRows: RawEarn[]; ladder: RawLadder[];
  strengths: RawStrength[]; warnings: Warning[]; hacks: Hack[]; insights: Insight[];
  intelligence?: CardIntel[];
  transferHacks?: TransferHack[];
  transferPartners?: TransferPartner[];
}

// ── The parsed, validated, indexed structure the app uses ────────────────────
export interface LoadedCardDB {
  version: string;
  cards: CardMeta[];
  cardById: Map<string, CardMeta>;
  earnByCard: Map<string, EarnRow[]>;
  strengths: Map<string, CategoryStrength>;
  /** ladder lookup: (ladderId, route) → best ₹/point for that route. */
  ladderLookup: (ladderId: string, route: string) => number | null;
  warnings: Warning[];
  hacks: Hack[];
  insights: Insight[];
  intelligence: CardIntel[];
  /** Liquidity facts for the APR/EMI calculator, keyed by cardId. */
  liquidity: Map<string, { aprAnnualPct: number | null; interestFreeDaysRetail: number | null; emiConversionAprPct: number | null }>;
  /** Pros/Cons/Tips per card, for the AI prose layer (NOT for math). */
  narrative: Map<string, { pros: string | null; cons: string | null; tips: string | null }>;
  transferHacks: TransferHack[];
  transferPartners: TransferPartner[];
}

const VALID_CATEGORIES = new Set<SpendCategory>([
  'Online', 'Travel', 'Dining', 'Fuel', 'Grocery', 'Utility',
  'Subscriptions', 'International', 'Other(base)',
]);
const VALID_ROWTYPES = new Set<RowType>(['base', 'spend_threshold', 'channel_conditional']);
const VALID_CAPPERIODS = new Set(['month', 'cycle', 'quarter', 'year']);

export class CardDBError extends Error {}

function normCapPeriod(p: string | null): CapPeriod | null {
  if (p == null) return null;
  const v = p.toLowerCase();
  if (!VALID_CAPPERIODS.has(v)) throw new CardDBError(`Invalid cap period: ${p}`);
  return v as CapPeriod;
}

function normThresholdPeriod(p: string | null): 'month' | 'cycle' | null {
  if (p == null) return null;
  const v = p.toLowerCase();
  return v === 'cycle' ? 'cycle' : 'month';
}

// ── Loader ───────────────────────────────────────────────────────────────────
export function loadCardDB(raw: RawDB): LoadedCardDB {
  if (!raw || !Array.isArray(raw.cards) || !Array.isArray(raw.earnRows)) {
    throw new CardDBError('cardDB.json missing required arrays (cards / earnRows).');
  }

  // CardMeta
  const cards: CardMeta[] = raw.cards.map((c) => {
    if (!c.cardId) throw new CardDBError('Card with no cardId.');
    return {
      cardId: c.cardId,
      ladderId: c.cardId, // ladderId resolved per-row from earn rows; meta keyed by cardId
      name: c.name ?? c.cardId,
      bank: c.bank ?? '',
      network: c.network ?? '',
      feeTier: c.feeTier ?? '',
      joiningFee: c.joiningFee ?? 0,
      annualFee: c.annualFee ?? 0,
      feeWaiverSpend: c.feeWaiverSpend ?? 0,
      forexPct: c.forexPct ?? 0,
      minSalary: c.minSalary ?? 0,
      minItr: c.minItr ?? 0,
      inviteOnly: !!c.inviteOnly,
      pros: c.pros ?? null,
      cons: c.cons ?? null,
      loungeStructured: c.loungeStructured ?? null,
      movieStructured: c.movieStructured ?? null,
      // rewardType derived below, once earn rows are indexed.
    };
  });
  const cardById = new Map(cards.map((c) => [c.cardId, c]));

  // EarnRows — validate each, fail loudly on bad enum / orphan card / silent-zero risk.
  const earnByCard = new Map<string, EarnRow[]>();
  for (const e of raw.earnRows) {
    if (!cardById.has(e.cardId)) {
      throw new CardDBError(`Earn row references unknown card ${e.cardId}.`);
    }
    if (!VALID_CATEGORIES.has(e.category as SpendCategory)) {
      throw new CardDBError(`Earn row ${e.cardId}/${e.category}: invalid category.`);
    }
    if (!VALID_ROWTYPES.has(e.rowType as RowType)) {
      throw new CardDBError(`Earn row ${e.cardId}/${e.category}: invalid rowType ${e.rowType}.`);
    }
    // Silent-zero guard: a non-excluded base/spend_threshold row MUST have earnNum+earnPer
    // (channel_conditional may be multiplier-only with null earnNum).
    if (!e.excluded && e.rowType !== 'channel_conditional') {
      if (e.earnNum == null || e.earnPer == null || e.earnPer === 0) {
        throw new CardDBError(
          `Earn row ${e.cardId}/${e.category}/${e.rowType}: missing earnNum/earnPer ` +
          `(would compute to ₹0 silently). Fix the DB before shipping.`
        );
      }
      if (e.rewardUnit !== 'cashback%' && (e.redeemValue == null)) {
        throw new CardDBError(
          `Earn row ${e.cardId}/${e.category}: points row with no redeemValue (silent ₹0 risk).`
        );
      }
    }
    const row: EarnRow = {
      cardId: e.cardId,
      ladderId: e.ladderId ?? e.cardId,
      category: e.category as SpendCategory,
      rowType: e.rowType as RowType,
      earnNum: e.earnNum,
      earnPer: e.earnPer,
      rewardUnit: e.rewardUnit,
      redemptionRoute: e.redemptionRoute,
      redeemValue: e.redeemValue,
      trigger: e.trigger,
      thresholdAmount: e.thresholdAmount,
      thresholdPeriod: normThresholdPeriod(e.thresholdPeriod),
      stacks: !!e.stacks,
      excluded: !!e.excluded,
      capAmount: e.capAmount,
      capPeriod: normCapPeriod(e.capPeriod),
      sharedCapId: e.sharedCapId,
      multiplierNote: e.multiplierNote,
    };
    const arr = earnByCard.get(e.cardId) ?? [];
    arr.push(row);
    earnByCard.set(e.cardId, arr);
  }

  // Every card must have at least one earn row (else it silently scores ₹0 everywhere).
  for (const c of cards) {
    if (!earnByCard.has(c.cardId)) {
      throw new CardDBError(`Card ${c.cardId} has no earn rows.`);
    }
  }

  // Derive rewardType strictly from existing earn-row redemption data (no guessing).
  // A card is 'cashback' when most of its guaranteed (non-excluded) earning redeems as direct
  // cash — rewardUnit 'cashback%' or redemptionRoute 'cashback'. Otherwise it's a points/rewards card.
  for (const c of cards) {
    const rows = (earnByCard.get(c.cardId) ?? []).filter((r) => !r.excluded);
    const cashRows = rows.filter(
      (r) => r.rewardUnit === 'cashback%' || r.redemptionRoute === 'cashback'
    ).length;
    c.rewardType = rows.length > 0 && cashRows * 2 >= rows.length ? 'cashback' : 'points';
  }

  // CategoryStrength
  const strengths = new Map<string, CategoryStrength>();
  for (const s of raw.strengths) {
    if (!s.cardId || !cardById.has(s.cardId)) continue; // strengths may include header/extra rows; skip non-cards
    strengths.set(s.cardId, {
      cardId: s.cardId,
      Online: s.Online ?? 0, Travel: s.Travel ?? 0, Dining: s.Dining ?? 0,
      Fuel: s.Fuel ?? 0, Grocery: s.Grocery ?? 0, International: s.International ?? 0,
      Overall: s.Overall ?? 0,
    });
  }

  // Ladder lookup: (ladderId, route) → max ₹/point for that route.
  const ladderIndex = new Map<string, RawLadder[]>();
  for (const l of raw.ladder) {
    const key = l.ladderId ?? l.cardId;
    const arr = ladderIndex.get(key) ?? [];
    arr.push(l);
    ladderIndex.set(key, arr);
  }
  const ladderLookup = (ladderId: string, route: string): number | null => {
    const rungs = ladderIndex.get(ladderId);
    if (!rungs) return null;
    const vals = rungs
      .filter((r) => r.route === route && r.valuePerPoint != null)
      .map((r) => r.valuePerPoint as number);
    return vals.length ? Math.max(...vals) : null;
  };

  // ── Ladder-reference integrity (Review gate) ──
  // (1) every earn row's ladderId must exist in the ladder table; (2) every non-excluded points
  // row's (ladderId, route) must resolve to a rung. A dangling reference would mean a card's
  // points value silently falls back / returns null → wrong or zero rupees. Fail loudly here.
  const ladderRouteSet = new Set(raw.ladder.map((l) => `${l.ladderId ?? l.cardId}|${l.route}`));
  for (const [cardId, rows] of earnByCard) {
    for (const e of rows) {
      if (!e.ladderId) continue;
      if (!ladderIndex.has(e.ladderId)) {
        throw new CardDBError(`Earn row ${cardId}/${e.category}: ladderId ${e.ladderId} not in ladder table.`);
      }
      const isPoints = e.rewardUnit !== 'cashback%' && !e.excluded && e.earnNum != null;
      if (isPoints && !ladderRouteSet.has(`${e.ladderId}|${e.redemptionRoute}`)) {
        throw new CardDBError(
          `Earn row ${cardId}/${e.category}/${e.rowType}: route '${e.redemptionRoute}' ` +
          `has no rung in ladder ${e.ladderId} (unresolvable redemption value).`
        );
      }
    }
  }

  // Liquidity + narrative
  const liquidity = new Map<string, { aprAnnualPct: number | null; interestFreeDaysRetail: number | null; emiConversionAprPct: number | null }>();
  const narrative = new Map<string, { pros: string | null; cons: string | null; tips: string | null }>();
  for (const c of raw.cards) {
    liquidity.set(c.cardId, {
      aprAnnualPct: c.aprAnnualPct ?? null,
      interestFreeDaysRetail: c.interestFreeDaysRetail ?? null,
      emiConversionAprPct: c.emiConversionAprPct ?? null,
    });
    narrative.set(c.cardId, { pros: c.pros ?? null, cons: c.cons ?? null, tips: c.tips ?? null });
  }

  return {
    version: raw.version,
    cards, cardById, earnByCard, strengths, ladderLookup,
    warnings: raw.warnings ?? [], hacks: raw.hacks ?? [], insights: raw.insights ?? [],
    intelligence: raw.intelligence ?? [],
    transferHacks: raw.transferHacks ?? [],
    transferPartners: raw.transferPartners ?? [],
    liquidity, narrative,
  };
}

/** Convenience: load from a fetched/imported JSON module. */
export async function loadCardDBFromUrl(url: string): Promise<LoadedCardDB> {
  const res = await fetch(url);
  if (!res.ok) throw new CardDBError(`Failed to fetch ${url}: ${res.status}`);
  return loadCardDB(await res.json());
}
