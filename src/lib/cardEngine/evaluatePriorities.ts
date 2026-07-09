/**
 * evaluatePriorities.ts — DISPLAY-LAYER priority surfacing (Priorities Feature).
 *
 * PURE & DETERMINISTIC. No I/O, no AI, no Date. Does NOT re-rank the engine.
 *
 * The engine ranks for SPEND. This module checks the user's selected priorities (top / secondary /
 * nice-to-have) against the ALREADY-RECOMMENDED card(s) and produces honest ✓ / ⚠ / ✗ lines so every
 * selected priority is visibly addressed. It never swaps, re-ranks, or invents values — every figure
 * comes from existing data fields (meta.forexPct, meta.loungeStructured, meta.movieStructured,
 * meta.rewardType, card.earn.perCategory).
 */

import type { MonthlySpend, SpendCategory } from './computeEarn';
import type { CardMeta, LoungeBlock, Priorities, PriorityKey, RankedCard } from './rankCards';

export type PriorityStatus = 'met' | 'partial' | 'unmet'; // ✓ / ⚠ / ✗
export type PriorityTier = 'top' | 'secondary' | 'niceToHave';

export interface PriorityEval {
  key: PriorityKey;
  tier: PriorityTier;
  status: PriorityStatus;
  line: string;            // the specific human line shown next to the glyph
}

const FOREX_BENCHMARK = 3.5;  // % — "typical" forex markup; below this is meaningfully low

/** Human label for a priority key (matches PrioritySelector). */
export const LABEL: Record<PriorityKey, string> = {
  Cashback: 'Cashback', Travel: 'Travel', Dining: 'Dining', Fuel: 'Fuel',
  Online: 'Online shopping', Lounge: 'Lounge access', Movies: 'Movies',
  Rewards: 'Rewards/points', Forex: 'Low forex',
};

/** Priorities that map directly to an engine spend category. */
const CATEGORY_PRIORITY: Partial<Record<PriorityKey, SpendCategory>> = {
  Travel: 'Travel', Dining: 'Dining', Fuel: 'Fuel', Online: 'Online',
};

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

/** Multiplier to turn total monthly spend into spend over a threshold period. */
function periodMultiplier(period: string | null): number {
  switch ((period ?? 'month').toLowerCase()) {
    case 'year': return 12;
    case 'quarter': return 3;
    default: return 1; // month / cycle
  }
}

function totalMonthlySpend(spend: MonthlySpend): number {
  return Object.values(spend).reduce((s, v) => s + (v ?? 0), 0);
}

// ── Per-priority evaluators ─────────────────────────────────────────────────

function evalForex(meta: CardMeta): { status: PriorityStatus; line: string } {
  const f = meta.forexPct ?? 0;
  if (f < FOREX_BENCHMARK) {
    return { status: 'met', line: `Low forex — ${f}% (vs ${FOREX_BENCHMARK}% typical)` };
  }
  return { status: 'unmet', line: `Forex ${f}% (not low)` };
}

function evalMovies(meta: CardMeta): { status: PriorityStatus; line: string } {
  const m = meta.movieStructured;
  if (!m || m.type === 'NONE') return { status: 'unmet', line: 'No movie benefit' };
  const value = m.annualValueComputed;
  const desc =
    m.type === 'BOGO' ? 'buy-one-get-one' :
    m.type === 'DISCOUNT' ? 'ticket discount' : 'annual movie value';
  const valStr = value != null ? `, ~${inr(value)}/yr value` : '';
  return { status: 'met', line: `Movies — ${desc}${valStr}` };
}

function evalRewardType(meta: CardMeta, want: 'cashback' | 'points'):
  { status: PriorityStatus; line: string } {
  const rt = meta.rewardType;
  if (rt === want) {
    return { status: 'met', line: want === 'cashback' ? 'Cashback card' : 'Rewards/points card' };
  }
  return want === 'cashback'
    ? { status: 'unmet', line: 'Earns points, not direct cashback' }
    : { status: 'unmet', line: 'Earns direct cashback, not points' };
}

function evalCategory(card: RankedCard, key: PriorityKey):
  { status: PriorityStatus; line: string } {
  const cat = CATEGORY_PRIORITY[key]!;
  const perYear = (card.earn.perCategory[cat]?.guaranteed ?? 0) * 12;
  if (perYear > 0) {
    return { status: 'met', line: `${LABEL[key]} — earns ${inr(perYear)}/yr` };
  }
  if (key === 'Fuel' && card.meta.fuelWaiver) {
    const fw = card.meta.fuelWaiver;
    const cap = fw.capAmount != null ? ` (capped ${inr(fw.capAmount)}/${fw.capPeriod ?? 'cycle'})` : '';
    return {
      status: 'unmet',
      line: `${LABEL[key]} — excluded, earns nothing, but waives ${fw.waiverPct}% surcharge on ${inr(fw.minTxn)}–${inr(fw.maxTxn)} txns${cap}`,
    };
  }
  return { status: 'unmet', line: `${LABEL[key]} — excluded, earns nothing` };
}

/**
 * Lounge — the HONEST UNLOCK CHECK. Evaluate each block against the user's spend and return the
 * best outcome (a met block beats a partial block beats none). The benefit is only "met" when any
 * spend gate is actually cleared by the user's spending.
 */
function evalLounge(meta: CardMeta, spend: MonthlySpend):
  { status: PriorityStatus; line: string } {
  const ls = meta.loungeStructured;
  const blocks: Array<{ label: string; block: LoungeBlock | null }> = [
    { label: 'domestic', block: ls?.domestic ?? null },
    { label: 'international', block: ls?.international ?? null },
    { label: 'railway', block: ls?.railway ?? null },
  ];
  const monthly = totalMonthlySpend(spend);
  const rank = { met: 2, partial: 1, unmet: 0 } as const;

  // Render EVERY populated block; overall status is the BEST block's status (any met block means
  // the priority is met — unchanged behaviour). The line lists ALL populated blocks so no lounge
  // type is silently dropped, and each clause reflects that block's own threshold/unlock state.
  // (Display note: this .line is not currently rendered — all lounge display flows through
  // ResultsScreenV2's priLine() — but kept in sync with it to avoid the two implementations drifting.)
  let bestStatus: PriorityStatus | null = null;
  const clauses: string[] = [];
  for (const { label, block } of blocks) {
    if (!block) continue;
    const threshold = block.spendThreshold ?? 0;
    const tPeriod = block.thresholdPeriod;
    const userPeriodSpend = monthly * periodMultiplier(tPeriod);
    // label always present, even for unlimited blocks
    const qty = block.unlimited
      ? `unlimited ${label}`
      : `${block.visits ?? 0} ${label}${block.visitPeriod ? `/${block.visitPeriod}` : ''}`;

    let status: PriorityStatus; let clause: string;
    if (threshold <= 0) {
      status = 'met';
      clause = `${qty} (no spend condition)`;
    } else if (userPeriodSpend >= threshold) {
      status = 'met';
      clause = `${qty}, unlocked — you spend ${inr(userPeriodSpend)}/${tPeriod ?? 'month'} vs ${inr(threshold)} needed`;
    } else {
      status = 'partial';
      clause = `${qty}, needs ${inr(threshold)}/${tPeriod ?? 'month'}, you spend ${inr(userPeriodSpend)} — you can't access this lounge`;
    }
    clauses.push(clause);
    if (bestStatus === null || rank[status] > rank[bestStatus]) bestStatus = status;
  }

  if (!clauses.length) return { status: 'unmet', line: 'No lounge access' };
  return { status: bestStatus ?? 'unmet', line: `Lounge — ${clauses.join('; ')}` };
}

// ── Dispatch ────────────────────────────────────────────────────────────────

/** Evaluate one priority against ONE card. */
export function evalPriorityForCard(
  key: PriorityKey,
  card: RankedCard,
  spend: MonthlySpend
): { status: PriorityStatus; line: string } {
  switch (key) {
    case 'Forex': return evalForex(card.meta);
    case 'Movies': return evalMovies(card.meta);
    case 'Lounge': return evalLounge(card.meta, spend);
    case 'Cashback': return evalRewardType(card.meta, 'cashback');
    case 'Rewards': return evalRewardType(card.meta, 'points');
    default: return evalCategory(card, key); // Travel / Dining / Fuel / Online
  }
}

const STATUS_RANK = { met: 2, partial: 1, unmet: 0 } as const;

/**
 * Evaluate a priority against the recommended SETUP (1 card or a combo). A priority is met if EITHER
 * card meets it — best status across the cards wins (so a combo gets credit for each card's strengths).
 */
export function evalPriorityForSetup(
  key: PriorityKey,
  cards: RankedCard[],
  spend: MonthlySpend
): { status: PriorityStatus; line: string } {
  let best: { status: PriorityStatus; line: string } | null = null;
  for (const c of cards) {
    const res = evalPriorityForCard(key, c, spend);
    if (!best || STATUS_RANK[res.status] > STATUS_RANK[best.status]) best = res;
  }
  return best ?? { status: 'unmet', line: '' };
}

/**
 * Walk the three tiers and produce a PriorityEval per SELECTED priority (skipping empty slots).
 * `cards` is the recommended setup (result.recommended): one card, or both cards of a combo.
 */
export function evaluatePriorities(
  priorities: Priorities | undefined,
  cards: RankedCard[],
  spend: MonthlySpend
): PriorityEval[] {
  if (!priorities || cards.length === 0) return [];
  const tiers: Array<[PriorityTier, PriorityKey | undefined]> = [
    ['top', priorities.top],
    ['secondary', priorities.secondary],
    ['niceToHave', priorities.niceToHave],
  ];
  const out: PriorityEval[] = [];
  for (const [tier, key] of tiers) {
    if (!key) continue;
    const { status, line } = evalPriorityForSetup(key, cards, spend);
    out.push({ key, tier, status, line });
  }
  return out;
}

// ── Alternative finder for a missed TOP priority ─────────────────────────────

export interface AlternativeForPriority {
  key: PriorityKey;            // the unmet/partial top priority
  card: RankedCard;            // the alternative that covers it
  optimalNet: number;          // X — recommended setup net/yr
  altNet: number;              // Y — alternative card net/yr
  costOfSwitch: number;        // X − Y (cost of switching away from the spend-optimal setup)
  line: string;                // the priority line for the alt card (e.g. "Cashback card")
}

/**
 * Find an alternative card that covers the user's TOP priority when the recommended setup misses it.
 * DISPLAY-ONLY — never re-ranks, never auto-adds; `ranked` is read-only. Fires only for an
 * unmet/partial TOP priority (secondary / nice-to-have are flagged, never substituted).
 * Returns null unless a net-POSITIVE card in `ranked` actually MEETS the priority.
 */
export function findAlternativeForMissedTop(
  priorities: Priorities | undefined,
  ranked: RankedCard[],
  recommended: RankedCard[],
  optimalNet: number,
  spend: MonthlySpend
): AlternativeForPriority | null {
  const key = priorities?.top;
  if (!key) return null;
  // Only act when the TOP priority is missed against the recommended setup.
  const setupStatus = evalPriorityForSetup(key, recommended, spend).status;
  if (setupStatus === 'met') return null;
  // Scan ranked (already best-net-first) for the highest-net card that MEETS it and is net-positive.
  for (const c of ranked) {
    if (c.netGuaranteedPerYear <= 0) continue;            // never surface a net-negative card
    if (recommended.some((r) => r.cardId === c.cardId)) continue; // an alt to the setup, not itself
    const ev = evalPriorityForCard(key, c, spend);
    if (ev.status !== 'met') continue;                    // met-only — no weak/partial alternatives
    return {
      key, card: c,
      optimalNet: Math.round(optimalNet),
      altNet: Math.round(c.netGuaranteedPerYear),
      costOfSwitch: Math.round(optimalNet - c.netGuaranteedPerYear),
      line: ev.line,
    };
  }
  return null;
}
