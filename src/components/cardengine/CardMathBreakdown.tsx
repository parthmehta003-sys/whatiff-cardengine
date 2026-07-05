/**
 * CardMathBreakdown.tsx — the personalised "Value Chart" (Spec §8.2).
 *
 * Renders the category-by-category guaranteed earn AFTER caps, then effective fee, then net —
 * the Axis Value-Chart format but computed from the USER's real spend. Every number here comes
 * from the engine (CardEarnResult); this component does ZERO math beyond display formatting and
 * summing values the engine already produced.
 *
 * The honesty moments are first-class: capped categories show "earned X → capped at Y", excluded
 * categories show ₹0 with the reason, and the effective-fee line shows the waiver.
 *
 * Styling: WhatIff tokens — dark zinc (#09090b), DM Sans, category accents.
 */

import React from 'react';
import type { CardEarnResult, CategoryEarn, SpendCategory } from '../../lib/cardEngine/computeEarn';

// Category → accent color (WhatIff palette: GROW emerald / BORROW purple / BUY cyan / PLAN amber).
// Spend categories mapped to a sensible accent for the breakdown bars.
const CAT_ACCENT: Record<string, string> = {
  Online: '#06b6d4',        // cyan
  Travel: '#10b981',        // emerald
  Dining: '#f59e0b',        // amber
  Fuel: '#8b5cf6',          // purple
  Grocery: '#10b981',
  Utility: '#8b5cf6',
  Subscriptions: '#06b6d4',
  International: '#10b981',
  'Other(base)': '#71717a', // zinc
};

const inr = (n: number) =>
  '₹' + Math.round(n).toLocaleString('en-IN');

// perCategory[cat].notes already duplicates three message types this component renders its own
// bespoke lines for (excluded, cap-hit, threshold-banding) — filter those out so we only surface
// the notes with no equivalent UI elsewhere (per-category channel/portal upside, catch-all
// inheritance, and any future note type not yet seen).
const DUPLICATE_NOTE_PATTERNS = [/^Excluded category/, /^Reward capped at/, /^Spend above/];
const nonDuplicateNotes = (notes: string[]) =>
  notes.filter((n) => !DUPLICATE_NOTE_PATTERNS.some((re) => re.test(n)));

interface Props {
  earn: CardEarnResult;
  effectiveAnnualFee: number;
  annualFee: number;          // sticker fee (to show "waived")
  feeWaiverSpend: number;
  netGuaranteedPerYear: number;
  annualUpside: number;
  /** monthly spend per category, to show the spend that generated each line */
  monthlySpend: Partial<Record<SpendCategory, number>>;
}

export const CardMathBreakdown: React.FC<Props> = ({
  earn, effectiveAnnualFee, annualFee, feeWaiverSpend,
  netGuaranteedPerYear, annualUpside, monthlySpend,
}) => {
  // Build display rows from categories the user actually spends in, sorted by annual guaranteed desc.
  const rows = (Object.keys(earn.perCategory) as SpendCategory[])
    .map((cat) => ({ cat, ce: earn.perCategory[cat], spend: monthlySpend[cat] ?? 0 }))
    .filter((r) => r.spend > 0)
    .sort((a, b) => b.ce.guaranteed - a.ce.guaranteed);

  const maxAnnual = Math.max(1, ...rows.map((r) => r.ce.guaranteed * 12));

  return (
    <div className="wf-breakdown">
      <style>{css}</style>

      <div className="wf-bd-head">
        <span>Where your value comes from</span>
        <span className="wf-bd-sub">your spend · annual reward</span>
      </div>

      <div className="wf-bd-rows">
        {rows.map(({ cat, ce, spend }) => (
          <CategoryRow
            key={cat}
            cat={cat}
            ce={ce}
            monthlySpend={spend}
            annual={ce.guaranteed * 12}
            maxAnnual={maxAnnual}
          />
        ))}
      </div>

      {/* Fee line */}
      <div className="wf-bd-feeline">
        <div className="wf-bd-fee-label">
          {effectiveAnnualFee === 0 && annualFee > 0 ? (
            <>
              <span className="wf-strike">{inr(annualFee)}</span>
              <span className="wf-waived">waived (you exceed {inr(feeWaiverSpend)} spend)</span>
            </>
          ) : effectiveAnnualFee === 0 ? (
            <span className="wf-waived">Lifetime Free — no annual fee</span>
          ) : (
            <span>Annual fee</span>
          )}
        </div>
        <div className="wf-bd-fee-val">
          {effectiveAnnualFee === 0 ? '−₹0' : '−' + inr(effectiveAnnualFee)}
        </div>
      </div>

      {/* Net */}
      <div className="wf-bd-net">
        <span>Annual net benefit</span>
        <span className="wf-bd-net-val">{inr(netGuaranteedPerYear)}</span>
      </div>

      {/* Upside (channel/portal), only if present */}
      {annualUpside > 0 && (
        <div className="wf-bd-upside">
          + up to {inr(annualUpside)}/yr extra if you route eligible spend through the card&rsquo;s
          portal/app <span className="wf-bd-upside-tag">conditional</span>
        </div>
      )}

      {/* Shared-cap notes (card-level) */}
      {earn.sharedCapAdjustments.map((note, i) => (
        <div key={i} className="wf-bd-capnote">{note}</div>
      ))}
    </div>
  );
};

const CategoryRow: React.FC<{
  cat: string; ce: CategoryEarn; monthlySpend: number; annual: number; maxAnnual: number;
}> = ({ cat, ce, monthlySpend, annual, maxAnnual }) => {
  const accent = CAT_ACCENT[cat] ?? '#71717a';
  const pct = Math.max(2, (annual / maxAnnual) * 100);
  const excluded = ce.excluded;
  const capped = ce.capHit;

  return (
    <div className={'wf-row' + (excluded ? ' wf-row-excl' : '')}>
      <div className="wf-row-top">
        <span className="wf-row-cat">
          <i className="wf-dot" style={{ background: excluded ? '#3f3f46' : accent }} />
          {cat === 'Other(base)' ? 'Everything else' : cat}
        </span>
        <span className="wf-row-val">
          {excluded ? (
            <span className="wf-zero">₹0</span>
          ) : (
            inr(annual) + '/yr'
          )}
        </span>
      </div>

      <div className="wf-row-spend">
        {inr(monthlySpend)}/mo
        {!excluded && ce.baseRatePer100 > 0 && (
          <span className="wf-rate"> · {ce.baseRatePer100.toFixed(2)}% back</span>
        )}
        {excluded && <span className="wf-exclnote"> · excluded — earns nothing</span>}
      </div>

      {!excluded && (
        <div className="wf-bar-track">
          <div className="wf-bar" style={{ width: pct + '%', background: accent }} />
        </div>
      )}

      {capped && ce.capBinding != null && (
        <div className="wf-caphit">
          earned {inr(ce.rawBeforeCap * 12)}/yr → capped at {inr(ce.capBinding * 12)}/yr
          <span className="wf-caphit-loss">
            {inr((ce.rawBeforeCap - ce.guaranteed) * 12)}/yr lost to the cap
          </span>
        </div>
      )}

      {ce.thresholdAmount != null && ce.thresholdRatePer100 != null && monthlySpend > ce.thresholdAmount && (
        <div className="wf-thresh">
          spend above {inr(ce.thresholdAmount)}/mo earns the boosted {ce.thresholdRatePer100.toFixed(2)}% rate
        </div>
      )}

      {nonDuplicateNotes(ce.notes).map((note, i) => (
        <div key={i} className="wf-row-note">{note}</div>
      ))}
    </div>
  );
};

const css = `
.wf-breakdown{font-family:'DM Sans',system-ui,sans-serif;color:#e4e4e7;background:#0c0c0e;
  border:1px solid #1f1f23;border-radius:14px;padding:18px 18px 16px;margin-top:10px}
.wf-bd-head{display:flex;justify-content:space-between;align-items:baseline;
  font-size:13px;font-weight:600;color:#a1a1aa;letter-spacing:.02em;margin-bottom:14px;
  text-transform:uppercase}
.wf-bd-sub{font-size:10px;font-weight:500;color:#52525b;text-transform:none;letter-spacing:0}
.wf-bd-rows{display:flex;flex-direction:column;gap:13px}
.wf-row-top{display:flex;justify-content:space-between;align-items:baseline}
.wf-row-cat{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600;color:#fafafa}
.wf-dot{width:8px;height:8px;border-radius:50%;display:inline-block}
.wf-row-val{font-size:14px;font-weight:700;color:#fafafa;font-variant-numeric:tabular-nums}
.wf-zero{color:#52525b;font-weight:600}
.wf-row-spend{font-size:11.5px;color:#71717a;margin:3px 0 5px 16px}
.wf-rate{color:#a1a1aa}
.wf-exclnote{color:#dc2626;opacity:.8}
.wf-bar-track{height:5px;background:#18181b;border-radius:3px;overflow:hidden;margin-left:16px}
.wf-bar{height:100%;border-radius:3px;transition:width .5s cubic-bezier(.2,.8,.2,1)}
.wf-row-excl{opacity:.62}
.wf-caphit{font-size:11px;color:#f59e0b;margin:5px 0 0 16px;display:flex;flex-wrap:wrap;gap:8px}
.wf-caphit-loss{color:#dc2626;font-weight:600}
.wf-thresh{font-size:11px;color:#10b981;margin:4px 0 0 16px}
.wf-row-note{font-size:11px;color:#71717a;margin:4px 0 0 16px;line-height:1.4}
.wf-bd-feeline{display:flex;justify-content:space-between;align-items:baseline;
  margin-top:16px;padding-top:13px;border-top:1px solid #1f1f23;font-size:13px}
.wf-bd-fee-label{color:#a1a1aa;display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
.wf-strike{text-decoration:line-through;color:#52525b}
.wf-waived{color:#10b981;font-weight:600}
.wf-bd-fee-val{color:#a1a1aa;font-weight:600;font-variant-numeric:tabular-nums}
.wf-bd-net{display:flex;justify-content:space-between;align-items:baseline;
  margin-top:12px;padding-top:13px;border-top:1px solid #27272a}
.wf-bd-net>span:first-child{font-size:14px;font-weight:600;color:#fafafa}
.wf-bd-net-val{font-size:24px;font-weight:800;color:#10b981;font-variant-numeric:tabular-nums;
  letter-spacing:-.02em}
.wf-bd-upside{margin-top:12px;font-size:12px;color:#a1a1aa;line-height:1.5;
  background:#18140a;border:1px solid #3a2f10;border-radius:9px;padding:9px 11px}
.wf-bd-upside-tag{display:inline-block;font-size:9px;font-weight:700;text-transform:uppercase;
  color:#f59e0b;border:1px solid #f59e0b;border-radius:4px;padding:1px 5px;margin-left:6px;
  letter-spacing:.05em;vertical-align:middle}
.wf-bd-capnote{margin-top:8px;font-size:11px;color:#f59e0b;line-height:1.5}
`;

export default CardMathBreakdown;
