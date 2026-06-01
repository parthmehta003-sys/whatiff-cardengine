/**
 * selectHacks.ts — choose the most relevant ACTIVE hack for a card given the user's spend &
 * priorities, and surface relevant cross-cutting insights. Pure & deterministic.
 *
 * Follows WhatIff_Card_Hacks_v2.md semantics:
 *   - each card may have a primary hack (Hack Name / Execution / Why It Matters / Status / Difficulty)
 *   - discontinued hacks are skipped (status, and cross-ref to DISCONTINUED_WARNINGS)
 *   - cross-cutting insights (e.g. Standing-Instructions for utility spenders, voucher stacking)
 *     are surfaced when their trigger conditions match the user
 *
 * The engine selects; the UI displays. No rupee math here beyond reading hack-provided values.
 */

import type { Hack, Insight, Warning } from './loadCardDB';
import type { MonthlySpend, SpendCategory } from './computeEarn';
import type { Priorities } from './rankCards';

export interface SelectedHack {
  cardId: string;
  name: string;
  whyItMatters: string;
  executionSteps: string | null;
  status: string | null;        // Active / Active-but-fading / Discontinued
  difficulty?: string | null;
  commonFailure?: string | null;
  lastVerified?: string | null;
  relevantCategories: string[];
  matchedOnSpend: boolean;       // true if chosen because user spends in its categories
}

export interface SurfacedInsight {
  topic: string;
  description: string;
  why: string;
}

/** Layer 3 — "Things to Know" per card. Benefit changes / devaluations / hidden perks.
 *  Kept SEPARATE from the hack (it is not a hack). Built from DISCONTINUED_WARNINGS. */
export interface CardIntelligenceItem {
  type: 'benefit_change' | 'devaluation' | 'hidden_benefit' | 'note';
  text: string;
  severity?: string | null;
}

export function cardIntelligence(
  cardId: string,
  warnings: Warning[],
  intelligence: { intelId?: string; cardId: string; type: string | null; title: string | null; description: string | null; severity: string | null }[] = []
): CardIntelligenceItem[] {
  const items: CardIntelligenceItem[] = [];
  // 1) devaluations / benefit changes from warnings
  for (const w of warnings) {
    if (!w.affectedCardIds) continue;
    const ids = w.affectedCardIds.split(/[,\s]+/).filter(Boolean);
    if (!ids.includes(cardId)) continue;
    const type: CardIntelligenceItem['type'] =
      w.changeType === 'devaluation' ? 'devaluation'
        : w.changeType === 'benefit_change' ? 'benefit_change'
        : 'note';
    const text = w.whatUserShouldKnow || w.whatChanged || '';
    if (text) items.push({ type, text, severity: w.severity });
  }
  // 2) positive/neutral facts from the CARD_INTELLIGENCE table
  for (const it of intelligence) {
    if (it.cardId !== cardId) continue;
    const t = (it.type || 'note').toLowerCase();
    const type: CardIntelligenceItem['type'] =
      t === 'hidden_benefit' ? 'hidden_benefit'
        : t === 'benefit_change' ? 'benefit_change'
        : t === 'devaluation' ? 'devaluation'
        : 'note';
    const text = it.title ? `${it.title} — ${it.description ?? ''}`.trim().replace(/ —\s*$/, '') : (it.description ?? '');
    if (text) items.push({ type, text, severity: it.severity });
  }
  return items;
}

const CAT_ALIASES: Record<string, SpendCategory[]> = {
  online: ['Online'], dining: ['Dining'], grocery: ['Grocery'], fuel: ['Fuel'],
  travel: ['Travel'], utility: ['Utility'], insurance: ['Utility'], // insurance maps to utility bucket
  subscription: ['Subscriptions'], subscriptions: ['Subscriptions'],
  international: ['International'], general: [], 'general purpose': [],
};

function userSpendsIn(categories: string[], spend: MonthlySpend): boolean {
  for (const c of categories) {
    const mapped = CAT_ALIASES[c.trim().toLowerCase()];
    if (!mapped) continue;
    for (const sc of mapped) if ((spend[sc] ?? 0) > 0) return true;
  }
  return false;
}

/**
 * Pick the single best ACTIVE hack for a card. Prefers hacks whose categories match the user's
 * spend and meet the min-monthly-spend bar; skips discontinued ones.
 */
export function selectHackForCard(
  cardId: string,
  hacks: Hack[],
  warnings: Warning[],
  spend: MonthlySpend,
  totalMonthlySpend: number
): SelectedHack | null {
  const cardHacks = hacks.filter((h) => h.cardId === cardId);
  if (cardHacks.length === 0) return null;

  // discontinued hack ids referenced by warnings
  const deadHackIds = new Set<string>();
  for (const w of warnings) {
    if (w.changeType === 'hack_discontinued' && w.affectedHackIds) {
      for (const id of w.affectedHackIds.split(/[,\s]+/).filter(Boolean)) deadHackIds.add(id);
    }
  }

  const candidates = cardHacks.filter((h) => {
    const status = (h.status ?? '').toLowerCase();
    if (status.includes('discontinued')) return false;
    if (deadHackIds.has(h.hackId)) return false;
    if (h.minMonthlySpend != null && totalMonthlySpend < h.minMonthlySpend) return false;
    return true;
  });
  if (candidates.length === 0) return null;

  // rank: spend-matched first, then by rate uplift (rateWithHack − rateWithoutHack) if present
  const scored = candidates.map((h) => {
    const cats = (h.relevantCategories ?? '').split(/[,\s]+/).filter(Boolean);
    const matched = userSpendsIn(cats, spend);
    const uplift = (h.rateWithHack ?? 0) - (h.rateWithoutHack ?? 0);
    return { h, matched, uplift, cats };
  }).sort((a, b) => {
    if (a.matched !== b.matched) return a.matched ? -1 : 1;
    return b.uplift - a.uplift;
  });

  const top = scored[0];
  const ctx: TokenContext = {
    monthlySpendInCats: monthlyMatchedSpend(top.cats, spend),
    rateUpliftPer100: (top.h.rateWithHack ?? 0) - (top.h.rateWithoutHack ?? 0),
    monthlyCap: top.h.monthlyCap ?? null,
  };
  return {
    cardId,
    name: top.h.hackName ?? 'Optimisation tip',
    whyItMatters: fillTokens(top.h.whyItMatters ?? '', ctx),
    executionSteps: fillTokens(top.h.executionSteps ?? '', ctx) || null,
    status: top.h.status,
    difficulty: (top.h as any).difficulty ?? null,
    commonFailure: fillTokens((top.h as any).commonFailure ?? '', ctx) || null,
    lastVerified: (top.h as any).lastVerified ?? null,
    relevantCategories: top.cats,
    matchedOnSpend: top.matched,
  };
}

interface TokenContext {
  monthlySpendInCats: number;   // user's monthly spend in the hack's categories
  rateUpliftPer100: number;     // extra % the hack unlocks
  monthlyCap: number | null;
}

function monthlyMatchedSpend(categories: string[], spend: MonthlySpend): number {
  let total = 0;
  for (const c of categories) {
    const mapped = CAT_ALIASES[c.trim().toLowerCase()];
    if (!mapped) continue;
    for (const sc of mapped) total += spend[sc] ?? 0;
  }
  return total;
}

/**
 * Replace [your spend] / {tokens} with the user's real figure where computable, else strip the
 * token phrase cleanly so no placeholder ever reaches the UI. Deterministic — no AI, no invented
 * numbers (only the user's own spend and the hack's own rate fields).
 */
export function fillTokens(text: string, ctx: TokenContext): string {
  if (!text) return '';
  let out = text;

  // If we can compute a monthly and an annual figure, fill the first two occurrences with them.
  const monthly = ctx.monthlySpendInCats > 0 ? ctx.monthlySpendInCats : null;
  const annualExtra =
    monthly != null && ctx.rateUpliftPer100 > 0
      ? Math.round(Math.min(monthly, ctx.monthlyCap ?? monthly) * (ctx.rateUpliftPer100 / 100) * 12)
      : null;

  const tokenRe = /₹?\s*(?:\[your spend\]|\{[^}]+\})/g;
  let filledMonthly = false, filledAnnual = false;
  out = out.replace(tokenRe, (m) => {
    // decide monthly vs annual by nearby words
    if (!filledMonthly && monthly != null) { filledMonthly = true; return '₹' + monthly.toLocaleString('en-IN'); }
    if (!filledAnnual && annualExtra != null) { filledAnnual = true; return '₹' + annualExtra.toLocaleString('en-IN'); }
    return '\u0000STRIP\u0000'; // mark leftover tokens for clean removal
  });

  // Clean up any leftover tokens we couldn't fill: remove the token plus dangling connectors,
  // so the surrounding sentence still reads naturally.
  out = out
    // "= ₹STRIP/year extra" -> drop the clause
    .replace(/\s*=\s*\u0000STRIP\u0000[^.]*\./g, '.')
    // "worth ₹STRIP+ via" -> "via"
    .replace(/\bworth\s*\u0000STRIP\u0000\+?\s*/g, '')
    // "Annual capture: ₹STRIP." -> drop trailing label clause
    .replace(/[;,]?\s*[A-Z][a-z]+(?:\s[a-z]+)?:\s*\u0000STRIP\u0000\.?/g, '.')
    // generic leftover token -> remove with optional trailing connector word
    .replace(/\u0000STRIP\u0000\+?\s*(?:via|on|of|extra|per year|\/year|\/month)?/g, '')
    // collapse artifacts
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,])/g, '$1')
    .replace(/\.\s*\./g, '.')
    .trim();

  return out;
}

/**
 * Surface cross-cutting insights whose trigger conditions match the user. Keep to top 2 (Spec §8.3).
 * Trigger matching is keyword-based against the insight's triggerConditions field.
 */
export function surfaceInsights(
  insights: Insight[],
  spend: MonthlySpend,
  priorities: Priorities | undefined,
  max = 2
): SurfacedInsight[] {
  const out: SurfacedInsight[] = [];
  const has = (c: SpendCategory) => (spend[c] ?? 0) > 0;
  const prioritySet = new Set(
    [priorities?.top, priorities?.secondary, priorities?.niceToHave].filter(Boolean) as string[]
  );

  for (const ins of insights) {
    const trig = (ins.triggerConditions ?? '').toLowerCase();
    let matched = false;
    // common triggers
    if (/utility|standing instruction|insurance/.test(trig) && (has('Utility'))) matched = true;
    if (/travel|transfer|miles|lounge/.test(trig) && (has('Travel') || prioritySet.has('Travel') || prioritySet.has('Lounge'))) matched = true;
    if (/voucher|smartbuy|gyftr|stacking/.test(trig) && (has('Online') || has('Grocery'))) matched = true;
    if (/devaluation|nerf/.test(trig)) matched = true; // always worth knowing
    if (!matched) continue;
    out.push({
      topic: ins.topic ?? 'Insight',
      description: ins.description ?? '',
      why: ins.relevance ?? '',
    });
    if (out.length >= max) break;
  }
  return out;
}
