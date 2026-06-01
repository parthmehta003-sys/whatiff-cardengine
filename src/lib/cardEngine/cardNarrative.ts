/**
 * cardNarrative.ts — produce the IMPACTFUL top pros & cons for a card, grounded in THIS user's
 * computed earn (not parsed from prose). Deterministic; the rupee figures come straight from the
 * engine's CardEarnResult. The raw Excel pros/cons text is passed through untouched for the
 * "Know more" full-list view.
 *
 *   PROS  → value-first: each pro leads with the rupee the user earns, then the reason.
 *   CONS  → with values where relevant: excluded categories, binding caps, and fee all quantified.
 *
 * "Impact" is strictly the rupees involved, so ranking is objective:
 *   pro impact  = annual guaranteed rupees from that category
 *   con impact  = annual rupees lost (excluded spend's would-be reward, cap leakage, or fee)
 */

import type { CardEarnResult, SpendCategory, MonthlySpend } from './computeEarn';
import type { CardMeta } from './rankCards';

export interface NarrativePoint {
  text: string;
  valuePerYear: number;   // signed rupee impact used for ranking (pros +, cons the magnitude lost)
  kind: 'pro' | 'con';
}

export interface CardNarrative {
  topPros: NarrativePoint[];
  topCons: NarrativePoint[];
  rawPros: string | null;   // verbatim Excel text for the "Know more" page
  rawCons: string | null;
}

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
const catLabel = (c: string) => (c === 'Other(base)' ? 'everyday spend' : c.toLowerCase());

export function buildCardNarrative(
  meta: CardMeta,
  earn: CardEarnResult,
  monthlySpend: MonthlySpend,
  effectiveAnnualFee: number,
  maxPros = 3,
  maxCons = 3
): CardNarrative {
  if (!meta || !earn) {
    return { topPros: [], topCons: [], rawPros: (meta as any)?.pros ?? null, rawCons: (meta as any)?.cons ?? null };
  }
  const cats = Object.keys(earn.perCategory) as SpendCategory[];

  // ---- PROS (value-first) ----
  const pros: NarrativePoint[] = [];

  // strongest earning categories for this user
  for (const c of cats) {
    const ce = earn.perCategory[c];
    if (ce.excluded || ce.guaranteed <= 0) continue;
    const annual = ce.guaranteed * 12;
    pros.push({
      kind: 'pro',
      valuePerYear: annual,
      text: `Earns you ${inr(annual)}/yr on ${catLabel(c)}${ce.baseRatePer100 > 0 ? ` at ${ce.baseRatePer100.toFixed(ce.baseRatePer100 % 1 ? 2 : 0)}%` : ''}.`,
    });
  }

  // fee waiver / LTF as a value pro
  if (meta.annualFee === 0) {
    pros.push({ kind: 'pro', valuePerYear: 1500, text: `Lifetime free — no annual fee to recover, ever.` });
  } else if (effectiveAnnualFee === 0) {
    pros.push({ kind: 'pro', valuePerYear: meta.annualFee, text: `Your spending waives the ${inr(meta.annualFee)} annual fee.` });
  }

  // low forex as a pro when relevant
  if (meta.forexPct != null && meta.forexPct <= 2 && (monthlySpend.International ?? 0) > 0) {
    const intlAnnual = (monthlySpend.International ?? 0) * 12;
    const saved = Math.round((3.5 - meta.forexPct) / 100 * intlAnnual);
    pros.push({ kind: 'pro', valuePerYear: saved, text: `Low ${meta.forexPct}% forex saves ~${inr(saved)}/yr on your overseas spend vs a typical 3.5% card.` });
  }

  // ---- CONS (with values) ----
  const cons: NarrativePoint[] = [];

  // excluded categories the user actually spends in → quantify the would-be reward lost
  for (const c of cats) {
    const ce = earn.perCategory[c];
    const spend = (monthlySpend[c] ?? 0) * 12;
    if (!ce.excluded || spend <= 0) continue;
    // estimate the loss at the card's "everyday" base rate if known, else a 1% reference
    const refRate = earn.perCategory['Other(base)']?.baseRatePer100 ?? 1;
    const lost = Math.round(spend * refRate / 100);
    cons.push({
      kind: 'con',
      valuePerYear: lost,
      text: `${c} is excluded — your ${inr(spend)}/yr there earns nothing (≈${inr(lost)}/yr you could earn elsewhere).`,
    });
  }

  // binding caps → quantify leakage above the cap
  for (const c of cats) {
    const ce = earn.perCategory[c];
    if (!ce.capHit) continue;
    const lost = Math.round((ce.rawBeforeCap - ce.guaranteed) * 12);
    if (lost <= 0) continue;
    cons.push({
      kind: 'con',
      valuePerYear: lost,
      text: `${c} reward is capped — you lose ~${inr(lost)}/yr on spend above the limit.`,
    });
  }

  // effective fee that is NOT waived
  if (effectiveAnnualFee > 0) {
    cons.push({
      kind: 'con',
      valuePerYear: effectiveAnnualFee,
      text: `Carries a ${inr(effectiveAnnualFee)}/yr fee your spending doesn't fully waive.`,
    });
  }

  // high forex when user spends internationally
  if (meta.forexPct != null && meta.forexPct >= 3 && (monthlySpend.International ?? 0) > 0) {
    const intlAnnual = (monthlySpend.International ?? 0) * 12;
    const cost = Math.round(meta.forexPct / 100 * intlAnnual);
    cons.push({
      kind: 'con',
      valuePerYear: cost,
      text: `${meta.forexPct}% forex markup costs ~${inr(cost)}/yr on your overseas spend.`,
    });
  }

  pros.sort((a, b) => b.valuePerYear - a.valuePerYear);
  cons.sort((a, b) => b.valuePerYear - a.valuePerYear);

  return {
    topPros: pros.slice(0, maxPros),
    topCons: cons.slice(0, maxCons),
    rawPros: (meta as any).pros ?? null,
    rawCons: (meta as any).cons ?? null,
  };
}
