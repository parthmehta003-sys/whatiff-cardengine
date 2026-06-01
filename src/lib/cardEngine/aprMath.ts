/**
 * aprMath.ts — WhatIff Card Engine liquidity calculator (the "cost of carrying a balance").
 *
 * PURE & DETERMINISTIC. No I/O, no AI, no Date. Standard finance math.
 *
 * Purpose (Logic Spec §9): an HONEST, anti-bank-marketing tool. It shows what revolving a
 * balance or converting to EMI actually costs — framed as "understand this so you can avoid it",
 * NOT as an EMI-sales aid. Decoupled from recommendations; lives below them in the UI.
 *
 * Data note: the card DB has APR for ~32/40 cards and NO EMI-conversion APR. So this is a
 * user-driven calculator: the card's stored APR (when present) is only a PREFILL default; the
 * user can override. Every output carries an "approximate — depends on your profile" caveat.
 */

// ────────────────────────────────────────────────────────────────────────────
// Constants & defaults
// ────────────────────────────────────────────────────────────────────────────

/** Typical Indian credit-card APR when a card's specific rate is unknown. Prefill only. */
export const DEFAULT_APR_ANNUAL_PCT = 42; // ~3.5%/month, mid of the common 36–48% band
/** Typical EMI-conversion APR when unknown. Prefill only. */
export const DEFAULT_EMI_APR_ANNUAL_PCT = 16;
/** Typical minimum-due percentage of outstanding balance. */
export const DEFAULT_MIN_DUE_PCT = 5;
/** Typical EMI processing fee (% of principal). */
export const DEFAULT_EMI_PROCESSING_PCT = 1.5;
/** GST on interest & fees (India). */
export const GST_PCT = 18;

const MAX_MONTHS = 600; // 50yr cap; beyond this we report "never clears at this payment"

// ────────────────────────────────────────────────────────────────────────────
// Revolving / minimum-due mode
// ────────────────────────────────────────────────────────────────────────────

export interface RevolvingInput {
  outstanding: number;        // ₹ balance carried
  aprAnnualPct?: number;      // card APR; falls back to DEFAULT_APR_ANNUAL_PCT
  /** Payment strategy: either a fixed ₹/month, or pay the minimum due each month. */
  monthlyPayment?: number;    // fixed ₹/month; if omitted, uses minimum-due mode
  minDuePct?: number;         // used in minimum-due mode; default DEFAULT_MIN_DUE_PCT
  minDueFloor?: number;       // absolute floor on min due (e.g. ₹200); default 200
  applyGstOnInterest?: boolean; // GST is charged on finance charges in India; default true
}

export interface RevolvingResult {
  monthsToClear: number | null;   // null = never clears at this payment
  totalInterest: number;          // ₹ (incl GST if applied)
  totalPaid: number;              // ₹ principal + interest
  effectiveAprUsed: number;       // the APR actually used (for transparency)
  neverClears: boolean;
  schedulePreview: Array<{ month: number; interest: number; payment: number; balance: number }>;
  caveat: string;
}

/**
 * Simulate carrying a balance month by month. This is the "scary honest" number — what a revolver
 * actually pays. Min-due mode shows the worst common case (paying only the minimum).
 */
export function simulateRevolving(input: RevolvingInput): RevolvingResult {
  const apr = clampPct(input.aprAnnualPct ?? DEFAULT_APR_ANNUAL_PCT, DEFAULT_APR_ANNUAL_PCT);
  const monthlyRate = apr / 12 / 100;
  const gstMult = (input.applyGstOnInterest ?? true) ? 1 + GST_PCT / 100 : 1;
  const minDuePct = input.minDuePct ?? DEFAULT_MIN_DUE_PCT;
  const minDueFloor = input.minDueFloor ?? 200;

  let balance = Math.max(0, input.outstanding);
  let totalInterest = 0;
  let totalPaid = 0;
  let months = 0;
  const schedulePreview: RevolvingResult['schedulePreview'] = [];

  while (balance > 0.01 && months < MAX_MONTHS) {
    months++;
    const interest = balance * monthlyRate * gstMult;
    let payment: number;
    if (input.monthlyPayment != null) {
      payment = input.monthlyPayment;
    } else {
      payment = Math.max(balance * (minDuePct / 100), minDueFloor) + interest;
      // min-due is typically % of principal PLUS that cycle's interest
    }
    // a payment that doesn't cover interest means the balance grows → never clears
    if (payment <= interest && input.monthlyPayment != null) {
      return neverClearsResult(apr, interest, input);
    }
    payment = Math.min(payment, balance + interest); // don't overpay the final month
    const principalPaid = payment - interest;
    balance = balance + interest - payment;
    if (balance < 0) balance = 0;
    totalInterest += interest;
    totalPaid += payment;
    if (months <= 6 || balance === 0) {
      schedulePreview.push({
        month: months,
        interest: round2(interest),
        payment: round2(payment),
        balance: round2(balance),
      });
    }
  }

  const neverClears = balance > 0.01;
  return {
    monthsToClear: neverClears ? null : months,
    totalInterest: round2(totalInterest),
    totalPaid: round2(totalPaid),
    effectiveAprUsed: apr,
    neverClears,
    schedulePreview,
    caveat:
      'Approximate. Actual interest depends on your bank\'s exact rate, billing cycle, and ' +
      'transaction dates. Paying the full statement balance each month avoids all of this.',
  };
}

function neverClearsResult(apr: number, interest: number, input: RevolvingInput): RevolvingResult {
  return {
    monthsToClear: null,
    totalInterest: Infinity,
    totalPaid: Infinity,
    effectiveAprUsed: apr,
    neverClears: true,
    schedulePreview: [{ month: 1, interest: round2(interest), payment: round2(input.monthlyPayment ?? 0), balance: round2(input.outstanding) }],
    caveat:
      'At this payment the balance never clears — the monthly payment does not cover the ' +
      'interest, so the debt grows. Increase the payment above the monthly interest.',
  };
}

// ────────────────────────────────────────────────────────────────────────────
// EMI-conversion mode
// ────────────────────────────────────────────────────────────────────────────

export interface EmiInput {
  principal: number;          // ₹ amount converted to EMI
  tenureMonths: number;       // e.g. 3, 6, 12, 24
  emiAprAnnualPct?: number;   // falls back to DEFAULT_EMI_APR_ANNUAL_PCT
  processingFeePct?: number;  // % of principal; default DEFAULT_EMI_PROCESSING_PCT
  applyGst?: boolean;         // GST on interest + processing fee; default true
}

export interface EmiResult {
  monthlyEmi: number;         // ₹/month
  totalInterest: number;      // ₹ (incl GST if applied)
  processingFee: number;      // ₹ (incl GST if applied)
  totalCost: number;          // principal + interest + processing fee
  costOverPayingInFull: number; // = totalCost − principal (the premium for financing)
  effectiveAprUsed: number;
  caveat: string;
}

/** Standard reducing-balance EMI: P·r·(1+r)^n / ((1+r)^n − 1). */
export function computeEmi(input: EmiInput): EmiResult {
  const apr = clampPct(input.emiAprAnnualPct ?? DEFAULT_EMI_APR_ANNUAL_PCT, DEFAULT_EMI_APR_ANNUAL_PCT);
  const n = Math.max(1, Math.round(input.tenureMonths));
  const r = apr / 12 / 100;
  const P = Math.max(0, input.principal);
  const gstMult = (input.applyGst ?? true) ? 1 + GST_PCT / 100 : 1;
  const procPct = input.processingFeePct ?? DEFAULT_EMI_PROCESSING_PCT;

  let emi: number;
  if (r === 0) {
    emi = P / n;
  } else {
    const pow = Math.pow(1 + r, n);
    emi = (P * r * pow) / (pow - 1);
  }
  const grossPayback = emi * n;
  const rawInterest = grossPayback - P;
  const interestWithGst = rawInterest * gstMult; // GST applies to the interest component
  const processingFee = P * (procPct / 100) * gstMult;
  const totalCost = P + interestWithGst + processingFee;

  return {
    monthlyEmi: round2(emi),
    totalInterest: round2(interestWithGst),
    processingFee: round2(processingFee),
    totalCost: round2(totalCost),
    costOverPayingInFull: round2(totalCost - P),
    effectiveAprUsed: apr,
    caveat:
      'Approximate. Actual EMI rate, processing fee, and GST treatment vary by bank and offer. ' +
      'Paying in full avoids the interest and processing fee entirely.',
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/** Guard against the DB's odd APR values (0, 0.45) being used as a real annual rate. */
function clampPct(value: number, fallback: number): number {
  // A credit-card annual APR below ~5% is almost certainly a data artifact (e.g. 0.45 meant 0.45%/mo
  // or a blank). Fall back to a realistic default rather than under-stating the cost.
  if (!Number.isFinite(value) || value < 5) return fallback;
  return value;
}

function round2(n: number): number {
  if (!Number.isFinite(n)) return n;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
