/**
 * optimizeRedemption.ts — PURE, DETERMINISTIC. No I/O, no Date, no AI.
 *
 * Given a card's Redemption object and the user's current point/mile balance,
 * ranks every redemption channel by their FLOOR (reliable) value and returns
 * the best option plus the full ranked list. Variable methods (airline
 * transfers) expose their high-end as upside but are ranked by their floor
 * so the recommended method is always the one the user can count on.
 * Cap-aware: when a capPerCycle exists and the balance exceeds it, marks the
 * channel as staged (multiple cycles needed).
 */

import type { Redemption, RedemptionMethod } from './loadCardDB';

export interface OptimizedMethod {
  channel: string;
  usablePoints: number;
  /**
   * Floor (reliable) rupee value — used for ranking.
   * For fixed methods this equals valueRupees. For variable methods this is
   * usable × valueRange[0] (the worst-case end the user can count on).
   */
  valueRupeesFloor: number;
  /** High-end rupee value — for variable methods this is the upside ceiling. */
  valueRupees: number;
  /** Low-end rupee value — set when valueIsVariable is true (same as valueRupeesFloor). */
  valueRupeesLow: number | undefined;
  valueIsVariable: boolean;
  /** True when balance exceeds capPerCycle; full redemption needs multiple cycles. */
  staged: boolean;
  /** Number of redemption cycles required to exhaust the balance (staged only). */
  cyclesNeeded: number | undefined;
  best: string | undefined;
  worst: string | undefined;
  note: string | undefined;
}

export interface RedemptionResult {
  currency: Redemption['currency'];
  currencyName: string;
  plainSummary: string;
  /** True for cashback/cashback-points cards — no action needed from user. */
  isCashback: boolean;
  /**
   * Best ranked method (highest floor value). Null only when there are no
   * methods or when isCashback is true.
   */
  best: OptimizedMethod | null;
  /** All methods sorted descending by valueRupeesFloor. */
  all: OptimizedMethod[];
}

function evalMethod(method: RedemptionMethod, balance: number): OptimizedMethod {
  const cap = method.capPerCycle;
  const usablePoints = cap != null ? Math.min(balance, cap) : balance;
  const staged = cap != null && balance > cap;
  const cyclesNeeded = staged && cap != null ? Math.ceil(balance / cap) : undefined;

  let valueRupees: number;
  let valueRupeesLow: number | undefined;
  let valueRupeesFloor: number;

  if (method.valueIsVariable && method.valueRange != null) {
    const [low, high] = method.valueRange;
    valueRupeesFloor = usablePoints * low;   // floor — what the user can count on
    valueRupees = usablePoints * high;        // upside ceiling
    valueRupeesLow = valueRupeesFloor;
  } else if (method.valuePerPoint != null) {
    valueRupeesFloor = usablePoints * method.valuePerPoint;
    valueRupees = valueRupeesFloor;           // fixed — floor = ceiling
    valueRupeesLow = undefined;
  } else {
    // Automatic cashback-style method — value is implicit (1:1 with ₹)
    valueRupeesFloor = usablePoints;
    valueRupees = usablePoints;
    valueRupeesLow = undefined;
  }

  return {
    channel: method.channel,
    usablePoints,
    valueRupeesFloor,
    valueRupees,
    valueRupeesLow,
    valueIsVariable: method.valueIsVariable,
    staged,
    cyclesNeeded,
    best: method.best,
    worst: method.worst,
    note: method.note,
  };
}

/**
 * Rank every redemption channel for this card at the given balance.
 * Methods are sorted by floor value (descending) so `best` is always the
 * channel with the highest guaranteed return. Variable methods appear lower
 * in the list despite potentially higher upside — the UI can surface their
 * valueRupees as an "up to X" figure.
 *
 * @param redemption  The card's `redemption` object from cardDB.
 * @param balance     The user's current point/mile balance (integer ≥ 0).
 */
export function optimizeRedemption(
  redemption: Redemption,
  balance: number,
): RedemptionResult {
  const isCashback =
    redemption.currency === 'cashback' ||
    (redemption.currency === 'cashback-points' && redemption.methods.length === 0);

  if (isCashback) {
    return {
      currency: redemption.currency,
      currencyName: redemption.currencyName,
      plainSummary: redemption.plainSummary,
      isCashback: true,
      best: null,
      all: [],
    };
  }

  const all = redemption.methods
    .map((m) => evalMethod(m, balance))
    .sort((a, b) => b.valueRupeesFloor - a.valueRupeesFloor);

  return {
    currency: redemption.currency,
    currencyName: redemption.currencyName,
    plainSummary: redemption.plainSummary,
    isCashback: false,
    best: all[0] ?? null,
    all,
  };
}
