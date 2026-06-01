/**
 * rankCards.ts — WhatIff Card Engine ranking layer.
 *
 * PURE & DETERMINISTIC. Builds on computeEarn.ts. No I/O, no AI, no Date.
 *
 * Implements Logic Spec:
 *   §4   eligibility filter (income / fee / invite) + filtered-out tracking (transparency)
 *   §6   net benefit (annual guaranteed − effective fee)
 *   §7   spend-shape detection + ranking + combo logic
 *   A1   two journeys (B = new card; A = already-owns, ranked by marginal gain)
 *   A2   math ranks; priorities break ties (±₹750) and relax fee tolerance one tier
 *   A2.1 ranked priority tiers (Top×3 / Secondary×2 / Nice-to-have×1)
 */

import {
  computeCardEarn,
  type EarnRow,
  type MonthlySpend,
  type SpendCategory,
  type CardEarnResult,
} from './computeEarn';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export interface CardMeta {
  cardId: string;
  ladderId: string;
  name: string;
  bank: string;
  network: string;
  feeTier: string;
  joiningFee: number;
  annualFee: number;
  feeWaiverSpend: number;   // 0 = none / LTF
  forexPct: number;
  minSalary: number;        // ₹L/yr salaried; 0 = no published bar
  minItr: number;           // ₹L/yr self-employed
  inviteOnly: boolean;
  pros?: string | null;
  cons?: string | null;
  imageUrl?: string;
  applyUrl?: string;
}

/** 1-10 editorial scores from CATEGORY_STRENGTHS. Tiebreak only — never primary ranking. */
export interface CategoryStrength {
  cardId: string;
  Online: number; Travel: number; Dining: number; Fuel: number;
  Grocery: number; International: number; Overall: number;
}

export type FeeTolerance = 'ltf_only' | 'upto_1000' | 'upto_5000' | 'any';
export type EmploymentType = 'salaried' | 'self_employed';

export type PriorityKey =
  | 'Cashback' | 'Travel' | 'Dining' | 'Fuel' | 'Online'
  | 'Lounge' | 'Movies' | 'Rewards' | 'Forex';

/** Ranked priority tiers (Spec A2.1). One selection each; weights 3/2/1. */
export interface Priorities {
  top?: PriorityKey;        // weight 3
  secondary?: PriorityKey;  // weight 2
  niceToHave?: PriorityKey; // weight 1
}

export interface UserInput {
  monthlySpend: MonthlySpend;
  inHandMonthlyIncome: number;   // take-home, not gross
  employmentType: EmploymentType;
  feeTolerance: FeeTolerance;
  priorities?: Priorities;
  redemptionPreference?: string; // 'auto' | 'cashback' | 'travel' | 'transfer' | ...
  creditScore?: number;          // for the soft disclaimer, not a hard filter
}

export type Journey = 'new_card' | 'owns_cards';

export interface FilteredOut {
  cardId: string;
  reasons: Array<'income' | 'fee'>;
}

export interface RankedCard {
  cardId: string;
  meta: CardMeta;
  earn: CardEarnResult;
  effectiveAnnualFee: number;
  netGuaranteedPerYear: number;   // annual guaranteed − effective fee  (THE headline number)
  annualUpside: number;
  priorityFitScore: number;       // tiebreak only
  inviteOnly: boolean;
  /** Journey A only: net gain vs the user's existing setup. */
  marginalGainPerYear?: number;
  notes: string[];
}

export type SpendShape = 'dominant' | 'clustered' | 'flat';

export interface RankResult {
  journey: Journey;
  spendShape: SpendShape;
  ranked: RankedCard[];           // eligible cards, best first
  recommended: RankedCard[];      // the 1-3 (or combo) we lead with
  runnersUp: RankedCard[];        // next few, for the carousel
  filteredOut: FilteredOut[];     // for the transparency block
  transparency: TransparencySummary;
  combo?: ComboRecommendation;    // when a 2-card combo wins (clustered/flat opt-in)
  ownedVerdicts?: OwnedVerdict[]; // Journey A only
  flatSpendNote?: string;         // Journey B flat-shape generalist explainer
  /**
   * Cards that EXCEED the user's stated fee tolerance but would rank well on the math, surfaced
   * separately as "outside your fee preference — worth considering" rather than silently relaxing
   * the filter. Populated when the user's top priority is Travel/Lounge. (Review Issue 1.)
   */
  premiumWorthConsidering?: RankedCard[];
  creditNote?: string;
}

export interface TransparencySummary {
  totalEvaluated: number;
  failedIncome: number;
  failedFee: number;
  inviteOnly: number;
  weakSpendMatch: number;
  fitCount: number;
}

export interface ComboRecommendation {
  cards: string[];                       // cardIds
  assignments: Record<string, SpendCategory[]>; // cardId -> categories it covers
  combinedAnnualValue: number;
  combinedFees: number;
  netPerYear: number;
  label: string;                         // "HDFC Millennia covers your ₹15k online+dining. ..."
}

export interface OwnedVerdict {
  cardId: string;
  cardName: string;
  verdict: 'keep' | 'underused' | 'wrong_fit';
  netPerYear: number;
  reason: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

const TIE_WINDOW = 750;        // ₹/yr — cards within this are a "tie", broken by priorities (A2)
const COMBO_MIN_GAIN = 3000;   // ₹/yr — second card only recommended if it adds at least this (R013)
const WEAK_MATCH_FLOOR = 1000; // ₹/yr net below which an eligible card is "weak spend match"
const RELEVANCE_RUNNERS = 4;   // runners-up carousel size

/** Map a priority to the CATEGORY_STRENGTHS field used to score fit. */
const PRIORITY_TO_STRENGTH: Record<PriorityKey, keyof CategoryStrength | null> = {
  Cashback: 'Overall', Travel: 'Travel', Dining: 'Dining', Fuel: 'Fuel',
  Online: 'Online', Rewards: 'Overall', Forex: null /* handled via forexPct */,
  Lounge: 'Travel' /* proxy */, Movies: null /* benefit layer, soft */,
};

// ────────────────────────────────────────────────────────────────────────────
// §4 Eligibility
// ────────────────────────────────────────────────────────────────────────────

const FEE_TIER_LIMIT: Record<FeeTolerance, number> = {
  ltf_only: 0, upto_1000: 1000, upto_5000: 5000, any: Infinity,
};

function incomeOk(meta: CardMeta, user: UserInput): boolean {
  if (meta.inviteOnly) return true; // invite-only: ranked, not income-gated (A1/§4)
  const floor = user.employmentType === 'self_employed' ? meta.minItr : meta.minSalary;
  if (floor === 0) return true;     // no published bar (0 ≠ "free"; means no salary floor)
  return user.inHandMonthlyIncome * 12 >= floor * 100000; // floor in ₹L/yr
}

function feeOk(meta: CardMeta, tolerance: FeeTolerance): boolean {
  return meta.annualFee <= FEE_TIER_LIMIT[tolerance];
}

/** Returns eligible cards + the filtered-out list (for transparency). */
export function filterEligible(
  cards: CardMeta[],
  user: UserInput,
  effectiveTolerance: FeeTolerance
): { eligible: CardMeta[]; filteredOut: FilteredOut[] } {
  const eligible: CardMeta[] = [];
  const filteredOut: FilteredOut[] = [];
  for (const m of cards) {
    const reasons: Array<'income' | 'fee'> = [];
    if (!incomeOk(m, user)) reasons.push('income');
    if (!feeOk(m, effectiveTolerance)) reasons.push('fee');
    if (reasons.length === 0) eligible.push(m);
    else filteredOut.push({ cardId: m.cardId, reasons });
  }
  return { eligible, filteredOut };
}

// ────────────────────────────────────────────────────────────────────────────
// §6 Net benefit
// ────────────────────────────────────────────────────────────────────────────

export function effectiveAnnualFee(meta: CardMeta, annualSpend: number): number {
  if (meta.feeWaiverSpend > 0 && annualSpend >= meta.feeWaiverSpend) return 0;
  return meta.annualFee;
}

function annualSpendOf(spend: MonthlySpend): number {
  return Object.values(spend).reduce((s, v) => s + (v ?? 0), 0) * 12;
}

// ────────────────────────────────────────────────────────────────────────────
// A2.1 Priority fit (tiebreak only)
// ────────────────────────────────────────────────────────────────────────────

function priorityFit(
  strength: CategoryStrength | undefined,
  meta: CardMeta,
  priorities?: Priorities
): number {
  if (!priorities || !strength) return 0;
  const tiers: Array<[PriorityKey | undefined, number]> = [
    [priorities.top, 3], [priorities.secondary, 2], [priorities.niceToHave, 1],
  ];
  let score = 0;
  for (const [p, w] of tiers) {
    if (!p) continue;
    if (p === 'Forex') {
      // lower forex is better; map 0% → 10, 3.5% → ~0
      score += w * Math.max(0, 10 - meta.forexPct * 2.8);
      continue;
    }
    const field = PRIORITY_TO_STRENGTH[p];
    if (field && field in strength) score += w * (strength[field] as number);
  }
  return score;
}

/**
 * Does the user's top priority make premium (over-tolerance) cards worth surfacing separately?
 * We do NOT relax the eligibility filter (that would put cards the user excluded into results
 * silently). Instead, travel/lounge-priority users get a separate "worth considering" band.
 * (Review Issue 1.)
 */
function wantsPremiumBand(user: UserInput): boolean {
  const top = user.priorities?.top;
  return top === 'Travel' || top === 'Lounge';
}

// ────────────────────────────────────────────────────────────────────────────
// §7.1 Spend shape
// ────────────────────────────────────────────────────────────────────────────

export function detectSpendShape(spend: MonthlySpend): SpendShape {
  const vals = Object.values(spend).filter((v): v is number => (v ?? 0) > 0);
  const total = vals.reduce((s, v) => s + v, 0);
  if (total === 0 || vals.length === 0) return 'flat';
  const maxShare = Math.max(...vals) / total;
  if (maxShare > 0.40) return 'dominant';
  if (maxShare < 0.22) return 'flat';
  return 'clustered';
}

// ────────────────────────────────────────────────────────────────────────────
// Core scoring of a single card
// ────────────────────────────────────────────────────────────────────────────

function scoreCard(
  meta: CardMeta,
  earnRows: EarnRow[],
  user: UserInput,
  strength: CategoryStrength | undefined
): RankedCard {
  const earn = computeCardEarn(meta.cardId, earnRows, user.monthlySpend, {
    redemptionPreference: user.redemptionPreference,
  });
  const annualSpend = annualSpendOf(user.monthlySpend);
  const effFee = effectiveAnnualFee(meta, annualSpend);
  const net = Math.round((earn.guaranteedPerYear - effFee) * 100) / 100;
  const notes: string[] = [];
  if (meta.inviteOnly) notes.push('Invite-only — ranked on fit, but not directly applicable.');
  if (meta.feeWaiverSpend > 0 && effFee === 0) {
    notes.push(`Annual fee ₹${meta.annualFee.toLocaleString('en-IN')} waived (you exceed the ₹${meta.feeWaiverSpend.toLocaleString('en-IN')} spend).`);
  }
  return {
    cardId: meta.cardId, meta, earn,
    effectiveAnnualFee: effFee,
    netGuaranteedPerYear: net,
    annualUpside: earn.upsidePerYear,
    priorityFitScore: priorityFit(strength, meta, user.priorities),
    inviteOnly: meta.inviteOnly,
    notes,
  };
}

/** Sort by net (primary); within ±TIE_WINDOW break by priority fit, then lower fee, then Overall. (A2) */
function rankSort(cards: RankedCard[], strengths: Map<string, CategoryStrength>): RankedCard[] {
  return cards.slice().sort((a, b) => {
    const dNet = b.netGuaranteedPerYear - a.netGuaranteedPerYear;
    if (Math.abs(dNet) > TIE_WINDOW) return dNet;
    // tie window → priority fit
    const dFit = b.priorityFitScore - a.priorityFitScore;
    if (Math.abs(dFit) > 1e-9) return dFit;
    // then lower effective fee
    const dFee = a.effectiveAnnualFee - b.effectiveAnnualFee;
    if (dFee !== 0) return dFee;
    // then editorial Overall
    const oa = strengths.get(a.cardId)?.Overall ?? 0;
    const ob = strengths.get(b.cardId)?.Overall ?? 0;
    return ob - oa;
  });
}

// ────────────────────────────────────────────────────────────────────────────
// §7.4 Combo "which card where"
// ────────────────────────────────────────────────────────────────────────────

function bestComboSecond(
  primary: RankedCard,
  pool: RankedCard[],
  user: UserInput
): { card: RankedCard; assignments: Record<string, SpendCategory[]>; gain: number } | null {
  const cats = (Object.keys(user.monthlySpend) as SpendCategory[]).filter(
    (c) => (user.monthlySpend[c] ?? 0) > 0
  );
  const monthlyFor = (cids: SpendCategory[]) =>
    cids.reduce((s, c) => s + (user.monthlySpend[c] ?? 0), 0);
  let best: { card: RankedCard; assignments: Record<string, SpendCategory[]>; gain: number } | null = null;
  for (const cand of pool) {
    if (cand.cardId === primary.cardId) continue;
    // Build assignments first — needed for routed-spend fee waivers below.
    const assignments: Record<string, SpendCategory[]> = {
      [primary.cardId]: [], [cand.cardId]: [],
    };
    let comboValue = 0;
    for (const cat of cats) {
      const p = primary.earn.perCategory[cat]?.guaranteed ?? 0;
      const c = cand.earn.perCategory[cat]?.guaranteed ?? 0;
      comboValue += Math.max(p, c) * 12;
      assignments[c > p ? cand.cardId : primary.cardId].push(cat);
    }
    // Fee waivers use routed spend (same basis as comboLabel) so the gate and display agree.
    const primaryFee = effectiveAnnualFee(primary.meta, monthlyFor(assignments[primary.cardId]) * 12);
    const candFee    = effectiveAnnualFee(cand.meta,    monthlyFor(assignments[cand.cardId])    * 12);
    const comboNet = comboValue - primaryFee - candFee;
    const gain = comboNet - primary.netGuaranteedPerYear;
    if (!best || gain > best.gain) best = { card: cand, assignments, gain };
  }
  if (!best || best.gain < COMBO_MIN_GAIN) return null;
  return best;
}

function comboLabel(
  primary: RankedCard, second: RankedCard,
  assignments: Record<string, SpendCategory[]>,
  user: UserInput
): ComboRecommendation {
  const monthlyFor = (cats: SpendCategory[]) =>
    cats.reduce((s, c) => s + (user.monthlySpend[c] ?? 0), 0);
  const part = (card: RankedCard) => {
    const cats = assignments[card.cardId] ?? [];
    const m = monthlyFor(cats);
    return `${card.meta.name} covers your ₹${m.toLocaleString('en-IN')}/mo ${cats.join(' + ')}`;
  };
  const combinedAnnualValue =
    (Object.keys(user.monthlySpend) as SpendCategory[])
      .filter((c) => (user.monthlySpend[c] ?? 0) > 0)
      .reduce((s, c) => {
        const p = primary.earn.perCategory[c]?.guaranteed ?? 0;
        const q = second.earn.perCategory[c]?.guaranteed ?? 0;
        return s + Math.max(p, q) * 12;
      }, 0);
  // Each card's fee waiver uses spend ROUTED to it (its assigned categories), not household total.
  const primaryFee = effectiveAnnualFee(primary.meta, monthlyFor(assignments[primary.cardId] ?? []) * 12);
  const secondFee = effectiveAnnualFee(second.meta, monthlyFor(assignments[second.cardId] ?? []) * 12);
  const combinedFees = primaryFee + secondFee;
  const net = Math.round((combinedAnnualValue - combinedFees) * 100) / 100;
  return {
    cards: [primary.cardId, second.cardId],
    assignments,
    combinedAnnualValue: Math.round(combinedAnnualValue * 100) / 100,
    combinedFees,
    netPerYear: net,
    label:
      `${part(primary)}. ${part(second)}. ` +
      `Combined annual value ₹${Math.round(combinedAnnualValue).toLocaleString('en-IN')} · ` +
      `Combined fees ₹${combinedFees.toLocaleString('en-IN')} · Net ₹${Math.round(net).toLocaleString('en-IN')}.`,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Credit-score soft note (A4)
// ────────────────────────────────────────────────────────────────────────────

function creditNote(score?: number): string | undefined {
  if (score == null) return undefined;
  if (score < 650) return 'Your credit score is below 650 — approval may be difficult. These are still your best-fit cards; consider building score first.';
  if (score < 700) return 'Approval may be harder below 700, but these remain your best-fit cards.';
  return undefined;
}

// ────────────────────────────────────────────────────────────────────────────
// MAIN ENTRY — Journey B (new card)
// ────────────────────────────────────────────────────────────────────────────

export function recommendNewCard(
  cards: CardMeta[],
  earnByCard: Map<string, EarnRow[]>,
  strengths: Map<string, CategoryStrength>,
  user: UserInput
): RankResult {
  // Strict fee filter — never silently relaxed. (Review Issue 1.)
  const { eligible, filteredOut } = filterEligible(cards, user, user.feeTolerance);

  const scored = eligible.map((m) =>
    scoreCard(m, earnByCard.get(m.cardId) ?? [], user, strengths.get(m.cardId))
  );
  const ranked = rankSort(scored, strengths);
  const shape = detectSpendShape(user.monthlySpend);

  const weakSpendMatch = ranked.filter((c) => c.netGuaranteedPerYear < WEAK_MATCH_FLOOR).length;
  const strong = ranked.filter((c) => c.netGuaranteedPerYear >= WEAK_MATCH_FLOOR);

  let recommended: RankedCard[] = [];
  let combo: ComboRecommendation | undefined;
  let flatSpendNote: string | undefined;

  let primary = strong[0] ?? ranked[0];

  // Invite-only top-slot guard (Review Issue 2): an invite-only card leads ONLY if its gain over
  // the best obtainable card is substantial; else the best obtainable card leads and the invite-only
  // one sits just below (still shown, badged), so the user isn't dead-ended on an unobtainable #1.
  if (primary?.inviteOnly) {
    const bestObtainable = ranked.find((c) => !c.inviteOnly);
    if (bestObtainable &&
        primary.netGuaranteedPerYear - bestObtainable.netGuaranteedPerYear < COMBO_MIN_GAIN) {
      primary = bestObtainable;
    }
  }

  if (primary) {
    recommended = [primary];
    if (shape === 'clustered') {
      const second = bestComboSecond(primary, strong, user);
      if (second) {
        recommended = [primary, second.card];
        combo = comboLabel(primary, second.card, second.assignments, user);
      }
    } else if (shape === 'flat') {
      flatSpendNote =
        'Your spending is spread evenly, so one well-rounded card beats juggling several. ' +
        'Prefer to optimise harder? See the 2-3 card setup below.';
      const second = bestComboSecond(primary, strong, user);
      if (second) combo = comboLabel(primary, second.card, second.assignments, user);
    }
  }

  const runnersUp = ranked
    .filter((c) => !recommended.some((r) => r.cardId === c.cardId))
    .slice(0, RELEVANCE_RUNNERS);

  // Premium "worth considering" band — over-tolerance cards for travel/lounge-priority users. (Issue 1)
  let premiumWorthConsidering: RankedCard[] | undefined;
  if (wantsPremiumBand(user)) {
    const overTolerance = cards.filter((m) => !feeOk(m, user.feeTolerance) && incomeOk(m, user));
    const premRanked = rankSort(
      overTolerance.map((m) => scoreCard(m, earnByCard.get(m.cardId) ?? [], user, strengths.get(m.cardId))),
      strengths
    ).filter((c) => c.netGuaranteedPerYear >= WEAK_MATCH_FLOOR).slice(0, 3);
    if (premRanked.length) premiumWorthConsidering = premRanked;
  }

  return {
    journey: 'new_card',
    spendShape: shape,
    ranked,
    recommended,
    runnersUp,
    filteredOut,
    transparency: {
      totalEvaluated: cards.length,
      failedIncome: filteredOut.filter((f) => f.reasons.includes('income')).length,
      failedFee: filteredOut.filter((f) => f.reasons.includes('fee')).length,
      inviteOnly: cards.filter((c) => c.inviteOnly).length,
      weakSpendMatch,
      fitCount: recommended.length,
    },
    combo,
    flatSpendNote,
    premiumWorthConsidering,
    creditNote: creditNote(user.creditScore),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// MAIN ENTRY — Journey A (already owns cards)
// ────────────────────────────────────────────────────────────────────────────

/** Best guaranteed annual value achievable from a set of owned cards (each category → best card). */
export function ownedSetupValue(
  owned: CardMeta[],
  earnByCard: Map<string, EarnRow[]>,
  user: UserInput
): { value: number; netByCard: Map<string, number>; effFees: number } {
  const cats = (Object.keys(user.monthlySpend) as SpendCategory[]).filter(
    (c) => (user.monthlySpend[c] ?? 0) > 0
  );
  const earnResults = new Map<string, CardEarnResult>();
  for (const m of owned) {
    earnResults.set(m.cardId, computeCardEarn(m.cardId, earnByCard.get(m.cardId) ?? [], user.monthlySpend, {
      redemptionPreference: user.redemptionPreference,
    }));
  }
  // Assign each category to the card that earns most on it; track BOTH reward earned AND
  // spend routed to each card (the latter drives that card's fee waiver — Review fix).
  let grossValue = 0;
  const contribByCard = new Map<string, number>();
  const spendRoutedToCard = new Map<string, number>(); // ₹/MONTH routed to each card
  for (const cat of cats) {
    let bestCard = ''; let bestVal = -1;
    for (const m of owned) {
      const v = earnResults.get(m.cardId)!.perCategory[cat]?.guaranteed ?? 0;
      if (v > bestVal) { bestVal = v; bestCard = m.cardId; }
    }
    grossValue += bestVal * 12;
    contribByCard.set(bestCard, (contribByCard.get(bestCard) ?? 0) + bestVal * 12);
    spendRoutedToCard.set(bestCard, (spendRoutedToCard.get(bestCard) ?? 0) + (user.monthlySpend[cat] ?? 0));
  }
  // Fee waiver per card uses the spend ACTUALLY ROUTED to that card (annualised), not household total.
  // A card the user barely uses won't clear its waiver, so its fee stands. (Review: combined-spend waiver.)
  const effFees = owned.reduce((s, m) => {
    const routedAnnual = (spendRoutedToCard.get(m.cardId) ?? 0) * 12;
    return s + effectiveAnnualFee(m, routedAnnual);
  }, 0);
  const netByCard = new Map<string, number>();
  for (const m of owned) netByCard.set(m.cardId, contribByCard.get(m.cardId) ?? 0);
  return { value: grossValue - effFees, netByCard, effFees };
}

export function reviewOwnedCards(
  cards: CardMeta[],
  ownedIds: string[],
  earnByCard: Map<string, EarnRow[]>,
  strengths: Map<string, CategoryStrength>,
  user: UserInput
): RankResult {
  const owned = cards.filter((c) => ownedIds.includes(c.cardId));
  const setup = ownedSetupValue(owned, earnByCard, user);

  // Verdict per owned card: how much of the user's spend does it actually win?
  const ownedVerdicts: OwnedVerdict[] = owned.map((m) => {
    const contribution = setup.netByCard.get(m.cardId) ?? 0;
    let verdict: OwnedVerdict['verdict'];
    let reason: string;
    if (contribution >= 3000) {
      verdict = 'keep';
      reason = `Earns ~₹${Math.round(contribution).toLocaleString('en-IN')}/yr on your spend — pulling its weight.`;
    } else if (contribution > 0) {
      verdict = 'underused';
      reason = `Only ~₹${Math.round(contribution).toLocaleString('en-IN')}/yr on your spend — you're not using its strengths.`;
    } else {
      verdict = 'wrong_fit';
      reason = `Earns nothing on your current spending pattern.`;
    }
    return { cardId: m.cardId, cardName: m.name, verdict, netPerYear: Math.round(contribution), reason };
  });

  // Candidates = all cards minus owned, ranked by MARGINAL GAIN over the current setup.
  const { eligible, filteredOut } = filterEligible(
    cards.filter((c) => !ownedIds.includes(c.cardId)), user, user.feeTolerance
  );

  const scored = eligible.map((m) => {
    const rc = scoreCard(m, earnByCard.get(m.cardId) ?? [], user, strengths.get(m.cardId));
    // marginal gain: value of (owned + this card) best-allocation, minus current setup
    const withCard = ownedSetupValue([...owned, m], earnByCard, user).value;
    rc.marginalGainPerYear = Math.round((withCard - setup.value) * 100) / 100;
    return rc;
  });

  // rank by marginal gain (primary), priority tiebreak within window
  const ranked = scored.slice().sort((a, b) => {
    const dGain = (b.marginalGainPerYear ?? 0) - (a.marginalGainPerYear ?? 0);
    if (Math.abs(dGain) > TIE_WINDOW) return dGain;
    return b.priorityFitScore - a.priorityFitScore;
  });

  const shape = detectSpendShape(user.monthlySpend);
  // Only recommend additions that beat the COMBO_MIN_GAIN threshold; else "your cards are right".
  const worthwhile = ranked.filter((c) => (c.marginalGainPerYear ?? 0) >= COMBO_MIN_GAIN);
  const recommended = worthwhile.slice(0, shape === 'flat' ? 1 : 2);
  const runnersUp = ranked
    .filter((c) => !recommended.some((r) => r.cardId === c.cardId))
    .slice(0, RELEVANCE_RUNNERS);

  return {
    journey: 'owns_cards',
    spendShape: shape,
    ranked,
    recommended,
    runnersUp,
    filteredOut,
    transparency: {
      totalEvaluated: cards.length,
      failedIncome: filteredOut.filter((f) => f.reasons.includes('income')).length,
      failedFee: filteredOut.filter((f) => f.reasons.includes('fee')).length,
      inviteOnly: cards.filter((c) => c.inviteOnly).length,
      weakSpendMatch: ranked.filter((c) => (c.marginalGainPerYear ?? 0) < WEAK_MATCH_FLOOR).length,
      fitCount: recommended.length,
    },
    ownedVerdicts,
    creditNote: creditNote(user.creditScore),
  };
}
