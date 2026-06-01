/**
 * SpendInput.tsx — the most important form (Spec A3). Captures monthly spend across the locked
 * 8 categories, displays annual prominently, and offers an income-band guided estimate for users
 * who can't itemise (the "no card → zero spend" case).
 *
 * Categories are EXACTLY the engine's SpendCategory set (minus Other(base), which is a fallback,
 * not a user input). Output is monthly ₹ per category → feeds computeCardEarn directly.
 *
 * Styling: WhatIff tokens.
 */
import React, { useState } from 'react';
import type { SpendCategory, MonthlySpend } from '../../lib/cardEngine/computeEarn';

const CATEGORIES: { key: SpendCategory; label: string; hint: string; accent: string; presets: number[] }[] = [
  { key: 'Online',        label: 'Online shopping', hint: 'Amazon, Flipkart, Myntra…', accent: '#06b6d4', presets: [5000, 15000, 35000] },
  { key: 'Dining',        label: 'Dining & food delivery', hint: 'Swiggy, Zomato, restaurants', accent: '#f59e0b', presets: [3000, 8000, 20000] },
  { key: 'Grocery',       label: 'Groceries', hint: 'BigBasket, supermarkets', accent: '#10b981', presets: [4000, 10000, 25000] },
  { key: 'Fuel',          label: 'Fuel', hint: 'Petrol, diesel', accent: '#8b5cf6', presets: [3000, 8000, 15000] },
  { key: 'Travel',        label: 'Travel', hint: 'Flights, hotels, cabs', accent: '#10b981', presets: [5000, 15000, 40000] },
  { key: 'Utility',       label: 'Utility bills', hint: 'Electricity, mobile, DTH', accent: '#8b5cf6', presets: [2000, 5000, 12000] },
  { key: 'Subscriptions', label: 'Subscriptions', hint: 'OTT, SaaS, memberships', accent: '#06b6d4', presets: [500, 1500, 4000] },
  { key: 'International',  label: 'International spend', hint: 'Forex, overseas online', accent: '#10b981', presets: [0, 5000, 20000] },
];

const PRESET_LABELS = ['Light', 'Medium', 'Heavy'];

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

// Income-band guided estimates (monthly ₹ per category). Coarse, user-adjustable starting points.
function guidedEstimate(monthlyIncome: number): MonthlySpend {
  // ~35–45% of take-home flows through a card for a typical urban user; split by rough category mix.
  const pool = monthlyIncome * 0.4;
  return {
    Online: Math.round(pool * 0.22),
    Dining: Math.round(pool * 0.16),
    Grocery: Math.round(pool * 0.18),
    Fuel: Math.round(pool * 0.12),
    Travel: Math.round(pool * 0.12),
    Utility: Math.round(pool * 0.10),
    Subscriptions: Math.round(pool * 0.04),
    International: Math.round(pool * 0.06),
  };
}

interface Props {
  initial?: MonthlySpend;
  monthlyIncome?: number;     // to power the guided estimate
  onContinue: (spend: MonthlySpend) => void;
  onBack?: () => void;
}

export const SpendInput: React.FC<Props> = ({ initial, monthlyIncome, onContinue, onBack }) => {
  const [spend, setSpend] = useState<MonthlySpend>(initial ?? {});

  const set = (k: SpendCategory, v: number) =>
    setSpend((s) => ({ ...s, [k]: Math.max(0, v) }));

  const totalMonthly = CATEGORIES.reduce((s, c) => s + (spend[c.key] ?? 0), 0);
  const hasAny = totalMonthly > 0;

  return (
    <div className="wf-si">
      <style>{css}</style>

      <div className="wf-si-head">
        <h2>How do you spend each month?</h2>
        <p>Enter what you route (or could route) through a card. We assume card-paid spend; cash you can&rsquo;t move to a card won&rsquo;t earn.</p>
      </div>

      {monthlyIncome ? (
        <button
          className="wf-si-guided"
          onClick={() => setSpend(guidedEstimate(monthlyIncome))}
        >
          ✦ Not sure? Start from a typical profile for your income, then adjust
        </button>
      ) : null}

      <div className="wf-si-grid">
        {CATEGORIES.map((c) => (
          <div className="wf-si-row" key={c.key}>
            <div className="wf-si-rowtop">
              <div className="wf-si-meta">
                <span className="wf-si-label"><i style={{ background: c.accent }} />{c.label}</span>
                <span className="wf-si-hint">{c.hint}</span>
              </div>
              <div className="wf-si-input">
                <span>₹</span>
                <input
                  type="number" inputMode="numeric" placeholder="0"
                  value={spend[c.key] ?? ''}
                  onChange={(e) => set(c.key, parseInt(e.target.value || '0', 10))}
                />
                <span className="wf-si-per">/mo</span>
              </div>
            </div>
            <div className="wf-si-presets">
              {c.presets.map((p, i) => (
                <button
                  key={i}
                  className={'wf-si-preset' + (spend[c.key] === p ? ' on' : '')}
                  onClick={() => set(c.key, p)}
                >
                  {PRESET_LABELS[i]}{p > 0 ? ` ₹${(p / 1000)}k` : ' —'}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="wf-si-total">
        <div>
          <div className="wf-si-total-m">{inr(totalMonthly)}/mo</div>
          <div className="wf-si-total-a">{inr(totalMonthly * 12)} a year through your card</div>
        </div>
        <div className="wf-si-actions">
          {onBack && <button className="wf-si-back" onClick={onBack}>Back</button>}
          <button className="wf-si-next" disabled={!hasAny} onClick={() => onContinue(spend)}>
            Continue →
          </button>
        </div>
      </div>
      {!hasAny && <div className="wf-si-empty">Add at least one category to continue.</div>}
    </div>
  );
};

const css = `
.wf-si{font-family:'DM Sans',system-ui,sans-serif;max-width:560px;margin:0 auto;color:#e4e4e7}
.wf-si-head h2{font-size:22px;font-weight:800;color:#fafafa;letter-spacing:-.02em;margin:0 0 6px}
.wf-si-head p{font-size:13px;color:#a1a1aa;line-height:1.55;margin:0 0 18px}
.wf-si-guided{width:100%;background:#0a1410;border:1px solid #134e34;color:#34d399;font-family:inherit;
  font-size:13px;font-weight:600;padding:12px;border-radius:10px;cursor:pointer;margin-bottom:16px;transition:.15s}
.wf-si-guided:hover{background:#0d1c16;border-color:#10b981}
.wf-si-grid{display:flex;flex-direction:column;gap:9px}
.wf-si-row{display:flex;flex-direction:column;gap:9px;
  background:#0c0c0e;border:1px solid #1f1f23;border-radius:12px;padding:12px 14px}
.wf-si-rowtop{display:flex;align-items:center;justify-content:space-between;gap:12px}
.wf-si-meta{display:flex;flex-direction:column;min-width:0}
.wf-si-label{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600;color:#fafafa}
.wf-si-label i{width:7px;height:7px;border-radius:50%;flex:0 0 auto}
.wf-si-hint{font-size:11px;color:#52525b;margin-left:15px}
.wf-si-input{display:flex;align-items:center;gap:4px;background:#111113;border:1px solid #27272a;
  border-radius:9px;padding:0 11px;flex:0 0 140px}
.wf-si-input span{color:#71717a;font-size:13px}
.wf-si-per{font-size:11px}
.wf-si-input input{width:100%;background:transparent;border:none;outline:none;color:#fafafa;
  font-family:inherit;font-size:15px;font-weight:600;padding:10px 0;text-align:right}
.wf-si-input input::-webkit-outer-spin-button,.wf-si-input input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
.wf-si-presets{display:flex;gap:6px}
.wf-si-preset{flex:1;background:#111113;border:1px solid #27272a;color:#8b8b93;font-family:inherit;
  font-size:11.5px;font-weight:600;padding:7px;border-radius:7px;cursor:pointer;transition:.12s}
.wf-si-preset:hover{border-color:#3f3f46;color:#c4c4c8}
.wf-si-preset.on{background:#0a1410;border-color:#10b981;color:#34d399}
.wf-si-total{display:flex;align-items:center;justify-content:space-between;margin-top:18px;
  padding-top:16px;border-top:1px solid #1f1f23}
.wf-si-total-m{font-size:20px;font-weight:800;color:#fafafa;font-variant-numeric:tabular-nums}
.wf-si-total-a{font-size:12px;color:#10b981;font-weight:600;margin-top:1px}
.wf-si-actions{display:flex;gap:8px}
.wf-si-back{background:#18181b;border:1px solid #27272a;color:#a1a1aa;font-family:inherit;
  font-size:14px;font-weight:600;padding:11px 18px;border-radius:10px;cursor:pointer}
.wf-si-next{background:#10b981;border:none;color:#04130c;font-family:inherit;font-size:14px;
  font-weight:700;padding:11px 22px;border-radius:10px;cursor:pointer;transition:.15s}
.wf-si-next:disabled{background:#1f2a24;color:#3f5a4e;cursor:not-allowed}
.wf-si-next:not(:disabled):hover{background:#34d399}
.wf-si-empty{font-size:12px;color:#71717a;text-align:right;margin-top:8px}
`;

export default SpendInput;
