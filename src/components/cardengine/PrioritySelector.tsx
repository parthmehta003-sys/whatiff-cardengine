/**
 * PrioritySelector.tsx — ranked priority tiers (Spec A2.1). Optional step.
 * Top (×3) / Secondary (×2) / Nice-to-have (×1), one selection each. Drives the tiebreak only —
 * math still ranks. Capped at 3 by design (unlimited destroys signal).
 */
import React, { useState } from 'react';
import type { Priorities, PriorityKey } from '../../lib/cardEngine/rankCards';

const OPTIONS: { key: PriorityKey; label: string }[] = [
  { key: 'Cashback', label: 'Cashback' },
  { key: 'Travel', label: 'Travel' },
  { key: 'Dining', label: 'Dining' },
  { key: 'Fuel', label: 'Fuel' },
  { key: 'Online', label: 'Online shopping' },
  { key: 'Lounge', label: 'Lounge access' },
  { key: 'Movies', label: 'Movies' },
  { key: 'Rewards', label: 'Rewards/points' },
  { key: 'Forex', label: 'Low forex' },
];

const TIERS: { slot: keyof Priorities; label: string; weight: string; accent: string }[] = [
  { slot: 'top', label: 'Top priority', weight: '×3', accent: '#10b981' },
  { slot: 'secondary', label: 'Secondary', weight: '×2', accent: '#06b6d4' },
  { slot: 'niceToHave', label: 'Nice to have', weight: '×1', accent: '#8b5cf6' },
];

interface Props {
  initial?: Priorities;
  onContinue: (p: Priorities) => void;
  onBack?: () => void;
  onSkip?: () => void;
}

export const PrioritySelector: React.FC<Props> = ({ initial, onContinue, onBack, onSkip }) => {
  const [p, setP] = useState<Priorities>(initial ?? {});

  // a priority can only occupy one tier; selecting it elsewhere moves it.
  const choose = (slot: keyof Priorities, key: PriorityKey) => {
    setP((prev) => {
      const next: Priorities = { ...prev };
      // remove key from any other slot
      (['top', 'secondary', 'niceToHave'] as (keyof Priorities)[]).forEach((s) => {
        if (next[s] === key) delete next[s];
      });
      next[slot] = next[slot] === key ? undefined : key;
      return next;
    });
  };

  const usedElsewhere = (slot: keyof Priorities, key: PriorityKey) =>
    (['top', 'secondary', 'niceToHave'] as (keyof Priorities)[]).some((s) => s !== slot && p[s] === key);

  return (
    <div className="wf-pr">
      <style>{css}</style>
      <h2>What matters most to you?</h2>
      <p className="wf-pr-sub">Optional. Pick what matters most to you. We use this to choose between cards that are close.</p>

      {TIERS.map((t) => (
        <div className="wf-pr-tier" key={t.slot}>
          <div className="wf-pr-tlabel">
            <span style={{ color: t.accent }}>{t.label}</span>
          </div>
          <div className="wf-pr-chips">
            {OPTIONS.map((o) => {
              const selected = p[t.slot] === o.key;
              const taken = usedElsewhere(t.slot, o.key);
              return (
                <button key={o.key}
                  className={'wf-chip' + (selected ? ' on' : '') + (taken ? ' taken' : '')}
                  style={selected ? { borderColor: t.accent, color: t.accent, background: t.accent + '14' } : undefined}
                  disabled={taken}
                  onClick={() => choose(t.slot, o.key)}>
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <div className="wf-pr-actions">
        {onBack && <button className="wf-pr-back" onClick={onBack}>Back</button>}
        <div className="wf-pr-right">
          {onSkip && <button className="wf-pr-skip" onClick={onSkip}>Skip</button>}
          <button className="wf-pr-next" onClick={() => onContinue(p)}>See my matches →</button>
        </div>
      </div>
    </div>
  );
};

const css = `
.wf-pr{font-family:'DM Sans',system-ui,sans-serif;max-width:560px;margin:0 auto;color:#e4e4e7}
.wf-pr h2{font-size:22px;font-weight:800;color:#fafafa;letter-spacing:-.02em;margin:0 0 6px}
.wf-pr-sub{font-size:13px;color:#a1a1aa;line-height:1.5;margin:0 0 20px}
.wf-pr-tier{margin-bottom:18px}
.wf-pr-tlabel{display:flex;align-items:baseline;gap:8px;font-size:13px;font-weight:700;margin-bottom:9px}
.wf-pr-w{font-size:10px;color:#52525b;font-weight:600}
.wf-pr-chips{display:flex;flex-wrap:wrap;gap:7px}
.wf-chip{background:#111113;border:1px solid #27272a;color:#a1a1aa;font-family:inherit;font-size:12.5px;
  font-weight:600;padding:8px 13px;border-radius:20px;cursor:pointer;transition:.12s}
.wf-chip:hover:not(:disabled){border-color:#3f3f46;color:#e4e4e7}
.wf-chip.taken{opacity:.3;cursor:not-allowed}
.wf-pr-actions{display:flex;justify-content:space-between;align-items:center;margin-top:24px}
.wf-pr-right{display:flex;gap:8px;margin-left:auto}
.wf-pr-back,.wf-pr-skip{background:#18181b;border:1px solid #27272a;color:#a1a1aa;font-family:inherit;font-size:14px;font-weight:600;padding:11px 18px;border-radius:10px;cursor:pointer}
.wf-pr-next{background:#10b981;border:none;color:#04130c;font-family:inherit;font-size:14px;font-weight:700;padding:11px 22px;border-radius:10px;cursor:pointer;transition:.15s}
.wf-pr-next:hover{background:#34d399}
`;

export default PrioritySelector;
