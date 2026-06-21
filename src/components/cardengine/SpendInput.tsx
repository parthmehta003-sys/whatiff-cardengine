/**
 * SpendInput.tsx — two-phase spend capture (Spec A3).
 *
 * Phase 1 (categories): tile grid — tap to select which categories you spend in.
 * Phase 2 (amounts): amount inputs + preset chips for selected categories only.
 *
 * Guided estimate auto-selects all 8 + fills amounts + lands on phase 2.
 * Back from phase 2 returns to phase 1 with selections and amounts preserved.
 * Commit: deselected categories pass 0 (not undefined) so engine sees a clean zero.
 */
import React, { useState } from 'react';
import {
  ShoppingCart, UtensilsCrossed, ShoppingBasket, Fuel,
  Plane, Zap, Repeat, Globe,
} from 'lucide-react';
import type { SpendCategory, MonthlySpend } from '../../lib/cardEngine/computeEarn';

export const CATEGORY_LABELS: Partial<Record<SpendCategory, string>> = {
  Online:        'Online shopping',
  Dining:        'Dining & food',
  Grocery:       'Groceries',
  Fuel:          'Fuel',
  Travel:        'Travel',
  Utility:       'Utility bills',
  Subscriptions: 'Subscriptions',
  International: 'International',
};

const CATEGORIES: {
  key: SpendCategory; label: string; hint: string; accent: string;
  presets: number[]; Icon: React.ElementType;
}[] = [
  { key: 'Online',        label: CATEGORY_LABELS.Online!,        hint: 'Amazon, Flipkart, Myntra…',      accent: '#06b6d4', presets: [5000,  15000, 35000], Icon: ShoppingCart    },
  { key: 'Dining',        label: CATEGORY_LABELS.Dining!,        hint: 'Swiggy, Zomato, restaurants',    accent: '#f59e0b', presets: [3000,  8000,  20000], Icon: UtensilsCrossed },
  { key: 'Grocery',       label: CATEGORY_LABELS.Grocery!,       hint: 'BigBasket, supermarkets',        accent: '#10b981', presets: [4000,  10000, 25000], Icon: ShoppingBasket  },
  { key: 'Fuel',          label: CATEGORY_LABELS.Fuel!,          hint: 'Petrol, diesel',                 accent: '#8b5cf6', presets: [3000,  8000,  15000], Icon: Fuel            },
  { key: 'Travel',        label: CATEGORY_LABELS.Travel!,        hint: 'Flights, hotels, cabs',          accent: '#f97316', presets: [5000,  15000, 40000], Icon: Plane           },
  { key: 'Utility',       label: CATEGORY_LABELS.Utility!,       hint: 'Electricity, mobile, DTH',       accent: '#a78bfa', presets: [2000,  5000,  12000], Icon: Zap             },
  { key: 'Subscriptions', label: CATEGORY_LABELS.Subscriptions!, hint: 'OTT, SaaS, memberships',         accent: '#38bdf8', presets: [500,   1500,  4000],  Icon: Repeat          },
  { key: 'International', label: CATEGORY_LABELS.International!, hint: 'Forex, overseas online',         accent: '#34d399', presets: [0,     5000,  20000], Icon: Globe           },
];

const PRESET_LABELS = ['Light', 'Medium', 'Heavy'];

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

function guidedEstimate(monthlyIncome: number): MonthlySpend {
  const pool = monthlyIncome * 0.4;
  return {
    Online:        Math.round(pool * 0.22),
    Dining:        Math.round(pool * 0.16),
    Grocery:       Math.round(pool * 0.18),
    Fuel:          Math.round(pool * 0.12),
    Travel:        Math.round(pool * 0.12),
    Utility:       Math.round(pool * 0.10),
    Subscriptions: Math.round(pool * 0.04),
    International: Math.round(pool * 0.06),
  };
}

type Phase = 'categories' | 'amounts';

interface Props {
  initial?: MonthlySpend;
  monthlyIncome?: number;
  onContinue: (spend: MonthlySpend) => void;
  onBack?: () => void;
}

export const SpendInput: React.FC<Props> = ({ initial, monthlyIncome, onContinue, onBack }) => {
  const [phase, setPhase] = useState<Phase>('categories');
  const [selected, setSelected] = useState<Set<SpendCategory>>(
    () => new Set(
      (Object.keys(initial ?? {}) as SpendCategory[]).filter(k => (initial?.[k] ?? 0) > 0)
    )
  );
  const [spend, setSpend] = useState<MonthlySpend>(initial ?? {});

  const toggle = (k: SpendCategory) =>
    setSelected(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const set = (k: SpendCategory, v: number) =>
    setSpend(s => ({ ...s, [k]: Math.max(0, v) }));

  const selectedCats = CATEGORIES.filter(c => selected.has(c.key));
  const totalMonthly = selectedCats.reduce((s, c) => s + (spend[c.key] ?? 0), 0);
  const hasAny = totalMonthly > 0;

  const handleContinue = () => {
    onContinue({
      ...Object.fromEntries(CATEGORIES.map(c => [c.key, 0])),
      ...Object.fromEntries(selectedCats.map(c => [c.key, spend[c.key] ?? 0])),
    } as MonthlySpend);
  };

  if (phase === 'categories') {
    return (
      <div className="wf-si">
        <style>{css}</style>

        <div className="wf-si-head">
          <h2>Where do you spend?</h2>
          <p>Select every category you route through a card — even partially. You&rsquo;ll set amounts next.</p>
        </div>

        {monthlyIncome ? (
          <button
            className="wf-si-guided"
            onClick={() => {
              const est = guidedEstimate(monthlyIncome);
              setSpend(est);
              setSelected(new Set(CATEGORIES.map(c => c.key)));
              setPhase('amounts');
            }}
          >
            ✦ Not sure? Start from a typical profile for your income, then adjust
          </button>
        ) : null}

        <div className="wf-si-cattiles">
          {CATEGORIES.map(c => {
            const sel = selected.has(c.key);
            const { Icon } = c;
            return (
              <button
                key={c.key}
                className={'wf-si-cattile' + (sel ? ' on' : '')}
                style={sel ? {
                  borderColor: c.accent,
                  boxShadow: `0 0 0 1px ${c.accent}33, 0 0 14px ${c.accent}22`,
                } : {}}
                onClick={() => toggle(c.key)}
              >
                <Icon size={22} strokeWidth={1.6} style={{ color: sel ? c.accent : undefined }} />
                <span>{c.label}</span>
              </button>
            );
          })}
        </div>

        <div className="wf-si-total" style={{ marginTop: 20 }}>
          <span className="wf-si-selcount">{selected.size} of 8 selected</span>
          <div className="wf-si-actions">
            {onBack && <button className="wf-si-back" onClick={onBack}>Back</button>}
            <button
              className="wf-si-next"
              disabled={selected.size === 0}
              onClick={() => setPhase('amounts')}
            >
              Set amounts →
            </button>
          </div>
        </div>
        {selected.size === 0 && <div className="wf-si-empty">Select at least one category to continue.</div>}
      </div>
    );
  }

  // Phase 2: amounts for selected categories only
  return (
    <div className="wf-si">
      <style>{css}</style>

      <div className="wf-si-head">
        <h2>How much do you spend?</h2>
        <p>Monthly card-paid spend per category. Use the chips for a quick estimate.</p>
      </div>

      <div className="wf-si-grid">
        {selectedCats.map((c) => (
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
          <button className="wf-si-back" onClick={() => setPhase('categories')}>Back</button>
          <button className="wf-si-next" disabled={!hasAny} onClick={handleContinue}>
            Continue →
          </button>
        </div>
      </div>
      {!hasAny && <div className="wf-si-empty">Add an amount to at least one category to continue.</div>}
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
.wf-si-cattiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px}
.wf-si-cattile{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:9px;
  background:#0c0c0e;border:1px solid #1f1f23;border-radius:12px;padding:18px 10px 16px;
  color:#71717a;font-family:inherit;font-size:12.5px;font-weight:600;cursor:pointer;min-height:82px;
  transition:border-color .15s,box-shadow .15s,color .15s;text-align:center;line-height:1.2}
.wf-si-cattile:hover{border-color:#3f3f46;color:#a1a1aa}
.wf-si-cattile.on{background:#141417;color:#fafafa}
.wf-si-selcount{font-size:13px;color:#52525b;font-weight:600}
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
