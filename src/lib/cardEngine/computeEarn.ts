/**
 * computeEarn.ts — WhatIff Card Engine core earn computation.
 *
 * PURE & DETERMINISTIC. No I/O, no randomness, no Date. Same input → same output.
 * This module is the single source of every rupee the user sees. The AI prose layer
 * NEVER computes; it only narrates the numbers produced here.
 *
 * Implements Logic Spec §5 (per-category earn: banding, caps, stacks, channel upside,
 * exclusions, inheritance rule) and §5.6 (card-level shared caps).
 *
 * Convention: a row's effective rate is ₹ returned per ₹100 spent =
 *   earnNum / earnPer * 100 * redeemValue           (points cards)
 *   earnNum (= cashback %) for cashback% rows (earnPer=100, redeemValue=1)
 * Excluded categories earn ₹0. channel_conditional earn is UPSIDE, never in the guaranteed total.
 */

// ────────────────────────────────────────────────────────────────────────────
// Types (mirror lib/cardEngine/types.ts; duplicated minimally here for module clarity)
// ────────────────────────────────────────────────────────────────────────────

export type RowType = 'base' | 'spend_threshold' | 'channel_conditional';

export type SpendCategory =
  | 'Online' | 'Travel' | 'Dining' | 'Fuel'
  | 'Grocery' | 'Utility' | 'Subscriptions' | 'International' | 'Other(base)';

export type CapPeriod = 'month' | 'cycle' | 'quarter' | 'year';

export interface EarnRow {
  cardId: string;
  ladderId: string;
  category: SpendCategory;
  rowType: RowType;
  earnNum: number | null;        // points or cashback %; null = multiplier-only channel row
  earnPer: number | null;        // spend unit (₹) the points accrue per; null when earnNum null
  rewardUnit: string;            // 'RP' | 'CashPoint' | 'EDGE RP' | ... | 'cashback%'
  redemptionRoute: string;       // 'cashback' | 'voucher' | 'travel' | 'transfer' | ...
  redeemValue: number | null;    // ₹/point for this row's route (1.0 for cashback%); null if excluded
  trigger: string | null;
  thresholdAmount: number | null;  // ₹ spend level above which a spend_threshold row applies
  thresholdPeriod: 'month' | 'cycle' | null;
  stacks: boolean;               // true = adds on top; false = alternative (higher-of / banded)
  excluded: boolean;
  capAmount: number | null;      // ₹ of REWARD earned
  capPeriod: CapPeriod | null;
  /**
   * Shared-cap bucket id. When rows in DIFFERENT categories share ONE physical cap
   * (e.g. CC19 ₹4,000/cycle pooled across online+offline; CC39 accel bucket across fuel+
   * dining+grocery), they carry the SAME sharedCapId and the engine clamps their COMBINED
   * earn. Rows with INDEPENDENT caps that happen to be equal in amount/period MUST have
   * different (or null) sharedCapId so they are NOT accidentally pooled. (Review Issue #1.)
   * null = cap (if any) is independent / per-category only.
   */
  sharedCapId: string | null;
  multiplierNote: string | null; // e.g. "tier_rate × 1.33" for blank-rate channel rows
}

/** Per-category result for a single card. All figures are ₹ PER MONTH unless annual* noted. */
export interface CategoryEarn {
  category: SpendCategory;
  guaranteed: number;      // ₹/month, after caps, base+spend_threshold only
  upside: number;          // ₹/month, best single channel route (NOT in guaranteed)
  rawBeforeCap: number;    // ₹/month guaranteed before cap clamp (for "you hit the cap" prose)
  capBinding: number | null; // ₹/month cap that bound this category, if any
  capHit: boolean;
  excluded: boolean;
  baseRatePer100: number;  // for prose
  thresholdRatePer100: number | null;
  thresholdAmount: number | null;
  inherited: boolean;      // true if rate inherited from Other(base) (issuer catch-all)
  noData: boolean;         // true if no rate and no catch-all to inherit
  notes: string[];
}

export interface CardEarnResult {
  cardId: string;
  perCategory: Record<string, CategoryEarn>;
  guaranteedPerMonth: number;   // Σ category.guaranteed after card-level shared caps
  upsidePerMonth: number;       // Σ category.upside (best routes)
  guaranteedPerYear: number;
  upsidePerYear: number;
  sharedCapAdjustments: string[]; // human notes when a card-level shared cap clamped totals
  /**
   * Spend-INDEPENDENT rate/exclusion for each category the priorities layer can key on
   * (Travel/Dining/Fuel/Online). Lets evalCategory()/priLine() distinguish a genuinely excluded
   * category from one the user simply entered ₹0 spend in (perCategory only holds spent categories).
   */
  categoryMeta: Record<string, { ratePer100: number; excluded: boolean; noData: boolean }>;
}

export type MonthlySpend = Partial<Record<SpendCategory, number>>;

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/** Effective ₹ per ₹100 for a row. Returns 0 for excluded; null for multiplier-only rows. */
export function rowRatePer100(row: EarnRow): number | null {
  if (row.excluded) return 0;
  if (row.earnNum == null || row.earnPer == null) return null; // multiplier-only channel row
  const rv = row.rewardUnit === 'cashback%' ? 1 : (row.redeemValue ?? 0);
  return (row.earnNum / row.earnPer) * 100 * rv;
}

/** Normalise a reward cap (₹) to a per-month figure for monthly spend math. */
export function capToMonthly(amount: number, period: CapPeriod | null): number {
  switch (period) {
    case 'quarter': return amount / 3;
    case 'year':    return amount / 12;
    case 'month':
    case 'cycle':   // statement cycle ≈ 1 month
    default:        return amount;
  }
}

/** Parse a "tier_rate × N" multiplier note → N (e.g. 1.33). Null if unparseable. */
export function parseMultiplier(note: string | null): number | null {
  if (!note) return null;
  const m = note.match(/[×x]\s*([\d.]+)/);
  return m ? parseFloat(m[1]) : null;
}

// ────────────────────────────────────────────────────────────────────────────
// Per-category computation (Spec §5.3)
// ────────────────────────────────────────────────────────────────────────────

interface ComputeOpts {
  /** If set, override each row's redeemValue by looking up this route on the card's ladder. */
  redemptionPreference?: string; // 'auto' (default) | 'cashback' | 'travel' | 'transfer' | ...
  ladderLookup?: (ladderId: string, route: string) => number | null;
}

function effectiveRedeem(row: EarnRow, opts: ComputeOpts): number {
  if (row.rewardUnit === 'cashback%') return 1;
  const pref = opts.redemptionPreference;
  if (pref && pref !== 'auto' && opts.ladderLookup) {
    const v = opts.ladderLookup(row.ladderId, pref);
    if (v != null) return v;
  }
  return row.redeemValue ?? 0;
}

function ratePer100With(row: EarnRow, opts: ComputeOpts): number | null {
  if (row.excluded) return 0;
  if (row.earnNum == null || row.earnPer == null) return null;
  return (row.earnNum / row.earnPer) * 100 * effectiveRedeem(row, opts);
}

/**
 * Compute one category's guaranteed + upside ₹/month for a card.
 * `allCardRows` = every EarnRow for this card (needed for the inheritance rule).
 */
export function computeCategory(
  category: SpendCategory,
  monthlySpend: number,
  cardRows: EarnRow[],
  opts: ComputeOpts = {}
): CategoryEarn {
  const notes: string[] = [];
  let rows = cardRows.filter((r) => r.category === category);
  let inherited = false;

  // ── Inheritance rule (Spec §5.3 / A v1.1): inherit Other(base) ONLY as a catch-all. ──
  if (rows.length === 0) {
    const catchAll = cardRows.filter((r) => r.category === 'Other(base)');
    if (catchAll.length > 0) {
      rows = catchAll;
      inherited = true;
      notes.push('Rate inherited from card base (issuer catch-all); category not separately listed.');
    } else {
      return blankCategory(category, true, 'No issuer-stated rate and no catch-all base (no-data).');
    }
  }

  // Fully excluded category → ₹0.
  if (rows.every((r) => r.excluded)) {
    return blankCategory(category, false, 'Excluded category — earns ₹0.', true);
  }

  const baseRows = rows.filter((r) => r.rowType === 'base' && !r.excluded);
  const thresholdRows = rows.filter((r) => r.rowType === 'spend_threshold' && !r.excluded);
  const channelRows = rows.filter((r) => r.rowType === 'channel_conditional' && !r.excluded);

  // ── Base rate: if multiple base rows (merchant accelerators), use the GENERAL (lowest) base
  //    for the guaranteed headline (Spec §5.4 — don't assume all spend is at the bonus merchant).
  //    Surface higher merchant rate as a note. ──
  const baseRates = baseRows
    .map((r) => ratePer100With(r, opts))
    .filter((x): x is number => x != null);
  const baseRate = baseRates.length ? Math.min(...baseRates) : 0;
  const maxBaseRate = baseRates.length ? Math.max(...baseRates) : 0;
  if (maxBaseRate > baseRate + 1e-9) {
    notes.push(
      `A higher ${maxBaseRate.toFixed(2)}%/₹100 rate applies to specific merchants in this category; ` +
      `headline uses the general ${baseRate.toFixed(2)}% rate (merchant share unknown).`
    );
  }

  // ── Threshold (banded) rate. spend_threshold applies to the rupee BAND above its trigger. ──
  // v1 SUPPORTS ONE THRESHOLD TIER ONLY (base + one accelerator). No current card needs
  // multi-tier (e.g. 0-20k→1%, 20k-50k→2%, 50k+→4%). If a card ever has >1 DISTINCT threshold
  // amount, we warn rather than silently use the first. (Review Issue #2.)
  const distinctThresholds = Array.from(
    new Set(thresholdRows.map((r) => r.thresholdAmount).filter((x) => x != null))
  );
  if (distinctThresholds.length > 1) {
    notes.push(
      `WARNING: ${distinctThresholds.length} distinct spend thresholds found; v1 models only one. ` +
      `Using the lowest. Multi-tier banding is a v2 feature.`
    );
  }
  const thr = thresholdRows
    .slice()
    .sort((a, b) => (a.thresholdAmount ?? Infinity) - (b.thresholdAmount ?? Infinity))[0];
  const thresholdAmount = thr?.thresholdAmount ?? null;
  const thresholdRate = (() => {
    const rs = thresholdRows.map((r) => ratePer100With(r, opts)).filter((x): x is number => x != null);
    return rs.length ? Math.max(...rs) : null;
  })();

  // Banding: below-band earns baseRate; above-band earns thresholdRate.
  // stacks=false (alternative tier) → above-band earns thresholdRate INSTEAD of base (standard bank structure).
  // stacks=true (rare) → above-band earns base + thresholdRate.
  let rawPerMonth: number;
  if (thresholdRate != null && thresholdAmount != null) {
    const below = Math.min(monthlySpend, thresholdAmount);
    const above = Math.max(0, monthlySpend - thresholdAmount);
    const stacksAdd = thr?.stacks === true;
    const aboveRate = stacksAdd ? baseRate + thresholdRate : thresholdRate;
    rawPerMonth = (below / 100) * baseRate + (above / 100) * aboveRate;
    if (above > 0) {
      notes.push(
        `Spend above ₹${thresholdAmount.toLocaleString('en-IN')}/mo earns the accelerated ` +
        `${thresholdRate.toFixed(2)}%/₹100 rate.`
      );
    }
  } else {
    rawPerMonth = (monthlySpend / 100) * baseRate;
  }

  // ── Per-category cap (₹ of reward). Card-level shared caps applied later in §5.6. ──
  const { clamped, binding, hit } = applyPerCategoryCap(rawPerMonth, rows);
  if (hit && binding != null) {
    notes.push(
      `Reward capped at ₹${Math.round(binding).toLocaleString('en-IN')}/mo — ` +
      `₹${Math.round(rawPerMonth - clamped).toLocaleString('en-IN')}/mo of potential reward is lost to the cap.`
    );
  }

  // ── Channel upside (NOT in guaranteed). Best single channel route. ──
  let upside = 0;
  for (const ch of channelRows) {
    let chRate = ratePer100With(ch, opts);
    if (chRate == null) {
      const mult = parseMultiplier(ch.multiplierNote);
      if (mult != null) chRate = baseRate * mult;
    }
    if (chRate == null) continue;
    let chEarn = (monthlySpend / 100) * chRate;
    const capped = applyPerCategoryCap(chEarn, [ch]);
    chEarn = capped.clamped;
    // Channel routes are ALTERNATIVE redemption paths — you redeem points one way, not several
    // simultaneously. We take the highest single achievable upside, never the sum. (Review Issue #3.)
    upside = Math.max(upside, chEarn);
  }
  if (upside > 0) {
    notes.push(`Up to ₹${Math.round(upside).toLocaleString('en-IN')}/mo extra if routed via the card's portal/app (conditional).`);
  }

  return {
    category,
    guaranteed: round2(clamped),
    upside: round2(upside),
    rawBeforeCap: round2(rawPerMonth),
    capBinding: binding,
    capHit: hit,
    excluded: false,
    baseRatePer100: round2(baseRate),
    thresholdRatePer100: thresholdRate == null ? null : round2(thresholdRate),
    thresholdAmount,
    inherited,
    noData: false,
    notes,
  };
}

function applyPerCategoryCap(
  raw: number,
  rows: EarnRow[]
): { clamped: number; binding: number | null; hit: boolean } {
  const caps = rows
    .filter((r) => r.capAmount != null)
    .map((r) => capToMonthly(r.capAmount as number, r.capPeriod));
  if (caps.length === 0) return { clamped: raw, binding: null, hit: false };
  const binding = Math.min(...caps);
  if (raw > binding) return { clamped: binding, binding, hit: true };
  return { clamped: raw, binding, hit: false };
}

function blankCategory(
  category: SpendCategory,
  noData: boolean,
  note: string,
  excluded = false
): CategoryEarn {
  return {
    category, guaranteed: 0, upside: 0, rawBeforeCap: 0,
    capBinding: null, capHit: false, excluded,
    baseRatePer100: 0, thresholdRatePer100: null, thresholdAmount: null,
    inherited: false, noData, notes: [note],
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Card-level computation + shared caps (Spec §5.6)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Compute a full card's guaranteed + upside ₹/month across all categories the user spends in,
 * then apply CARD-LEVEL shared caps (rows in different categories sharing one capAmount+capPeriod
 * bucket, e.g. CC19 ₹4,000/cycle across online+offline; CC39 7,500 RP/mo across fuel+dining+grocery).
 */
export function computeCardEarn(
  cardId: string,
  cardRows: EarnRow[],
  monthlySpend: MonthlySpend,
  opts: ComputeOpts = {}
): CardEarnResult {
  const categories = Object.keys(monthlySpend) as SpendCategory[];
  const perCategory: Record<string, CategoryEarn> = {};
  for (const cat of categories) {
    const spend = monthlySpend[cat] ?? 0;
    if (spend <= 0) continue;
    perCategory[cat] = computeCategory(cat, spend, cardRows, opts);
  }

  const sharedCapAdjustments: string[] = [];

  // Shared cap buckets: group categories whose rows carry the SAME sharedCapId. ONLY explicit
  // sharedCapId pools earn across categories — equal capAmount/capPeriod alone does NOT (those
  // are independent per-category caps, already applied in computeCategory). (Review Issue #1.)
  const buckets = new Map<string, { capMonthly: number; cats: SpendCategory[] }>();
  for (const cat of categories) {
    const ce = perCategory[cat];
    if (!ce || ce.excluded || ce.noData) continue;
    const catRows = cardRows.filter(
      (r) => r.category === cat && r.capAmount != null && r.sharedCapId != null
    );
    for (const r of catRows) {
      const key = r.sharedCapId as string;
      const capMonthly = capToMonthly(r.capAmount as number, r.capPeriod);
      const b = buckets.get(key) ?? { capMonthly, cats: [] };
      // a shared bucket's cap is a single physical limit; all member rows quote the same amount
      b.capMonthly = capMonthly;
      if (!b.cats.includes(cat)) b.cats.push(cat);
      buckets.set(key, b);
    }
  }

  // Clamp each multi-category shared bucket's COMBINED guaranteed earn to its cap.
  for (const [, b] of buckets) {
    if (b.cats.length < 2) continue; // single-category cap already handled in computeCategory
    const sumGuaranteed = b.cats.reduce((s, c) => s + perCategory[c].guaranteed, 0);
    if (sumGuaranteed > b.capMonthly + 1e-9) {
      const scale = b.capMonthly / sumGuaranteed;
      for (const c of b.cats) {
        perCategory[c].guaranteed = round2(perCategory[c].guaranteed * scale);
        perCategory[c].capHit = true;
      }
      sharedCapAdjustments.push(
        `Shared cap ₹${Math.round(b.capMonthly).toLocaleString('en-IN')}/mo across ` +
        `${b.cats.join(', ')} — combined reward clamped (you hit it before month-end).`
      );
    }
  }

  const guaranteedPerMonth = round2(
    categories.reduce((s, c) => s + (perCategory[c]?.guaranteed ?? 0), 0)
  );
  const upsidePerMonth = round2(
    categories.reduce((s, c) => s + (perCategory[c]?.upside ?? 0), 0)
  );

  // Spend-independent rate/exclusion for the category-priority categories. computeCategory(cat, 0, …)
  // reports baseRatePer100 + excluded + noData regardless of user spend; reuse an already-computed
  // perCategory entry when the user did spend there. Consumed only by the priorities display layer.
  const PRIORITY_CATS: SpendCategory[] = ['Travel', 'Dining', 'Fuel', 'Online'];
  const categoryMeta: Record<string, { ratePer100: number; excluded: boolean; noData: boolean }> = {};
  for (const cat of PRIORITY_CATS) {
    const ce = perCategory[cat] ?? computeCategory(cat, 0, cardRows, opts);
    categoryMeta[cat] = { ratePer100: ce.baseRatePer100, excluded: ce.excluded, noData: ce.noData };
  }

  return {
    cardId,
    perCategory,
    guaranteedPerMonth,
    upsidePerMonth,
    guaranteedPerYear: round2(guaranteedPerMonth * 12),
    upsidePerYear: round2(upsidePerMonth * 12),
    sharedCapAdjustments,
    categoryMeta,
  };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
