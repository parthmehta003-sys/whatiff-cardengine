/**
 * PrioritySelector.tsx — ranked priority tiers (Spec A2.1). Optional step.
 * UI: ordered pick (tap to select in order; 1st → top ×3, 2nd → secondary ×2, 3rd → nice-to-have ×1).
 * Engine wiring is unchanged — output is still the Priorities object with top/secondary/niceToHave fields.
 */
import React, { useState } from 'react';
import type { Priorities, PriorityKey } from '../../lib/cardEngine/rankCards';

const OPTIONS: { key: PriorityKey; label: string }[] = [
  { key: 'Cashback',  label: 'Cashback' },
  { key: 'Travel',   label: 'Travel' },
  { key: 'Dining',   label: 'Dining' },
  { key: 'Fuel',     label: 'Fuel' },
  { key: 'Online',   label: 'Online shopping' },
  { key: 'Lounge',   label: 'Lounge access' },
  { key: 'Movies',   label: 'Movies' },
  { key: 'Rewards',  label: 'Rewards/points' },
  { key: 'Forex',    label: 'Low forex' },
];

const SLOTS: (keyof Priorities)[] = ['top', 'secondary', 'niceToHave'];

/** Convert ordered picks array → Priorities object the engine expects. */
function picksToTiers(picks: PriorityKey[]): Priorities {
  const p: Priorities = {};
  if (picks[0]) p.top = picks[0];
  if (picks[1]) p.secondary = picks[1];
  if (picks[2]) p.niceToHave = picks[2];
  return p;
}

/** Convert existing Priorities object → ordered picks array (for initial state). */
function tiersToPicksArray(p: Priorities | undefined): PriorityKey[] {
  if (!p) return [];
  const arr: PriorityKey[] = [];
  if (p.top)         arr.push(p.top);
  if (p.secondary)   arr.push(p.secondary);
  if (p.niceToHave)  arr.push(p.niceToHave);
  return arr;
}

const RANK_LABEL = ['#1', '#2', '#3'];
const RANK_ACCENT = ['#10b981', '#06b6d4', '#8b5cf6'];

interface Props {
  initial?: Priorities;
  onContinue: (p: Priorities) => void;
  onBack?: () => void;
  onSkip?: () => void;
}

export const PrioritySelector: React.FC<Props> = ({ initial, onContinue, onBack, onSkip }) => {
  const [picks, setPicks] = useState<PriorityKey[]>(tiersToPicksArray(initial));

  const toggle = (key: PriorityKey) => {
    setPicks((prev) => {
      const idx = prev.indexOf(key);
      if (idx !== -1) {
        // deselect — remove from array, shift others up
        return prev.filter((k) => k !== key);
      }
      if (prev.length >= 3) return prev; // already have 3, ignore
      return [...prev, key];
    });
  };

  const remove = (idx: number) => {
    setPicks((prev) => prev.filter((_, i) => i !== idx));
  };

  return (
    <div className="wf-pr">
      <style>{css}</style>
      <h2>What matters most to you?</h2>
      <p className="wf-pr-sub">
        Pick up to 3, most important first — we'll match as many as we can.
      </p>

      {/* Selected order strip */}
      <div className="wf-pr-order">
        {SLOTS.map((_, i) => {
          const key = picks[i];
          const label = key ? OPTIONS.find(o => o.key === key)?.label : null;
          return (
            <div
              key={i}
              className={'wf-pr-slot' + (key ? ' filled' : '')}
              style={key ? { borderColor: RANK_ACCENT[i] } as React.CSSProperties : undefined}
            >
              <span className="wf-pr-slot-num" style={key ? { color: RANK_ACCENT[i] } : undefined}>
                {RANK_LABEL[i]}
              </span>
              {key ? (
                <>
                  <span className="wf-pr-slot-lbl">{label}</span>
                  <button className="wf-pr-slot-x" onClick={() => remove(i)} aria-label={`Remove ${label}`}>✕</button>
                </>
              ) : (
                <span className="wf-pr-slot-empty">not set</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Option chips */}
      <div className="wf-pr-chips">
        {OPTIONS.map((o) => {
          const pickIdx = picks.indexOf(o.key);
          const selected = pickIdx !== -1;
          const full = picks.length >= 3 && !selected;
          return (
            <button
              key={o.key}
              className={'wf-chip' + (selected ? ' on' : '') + (full ? ' dim' : '')}
              style={selected
                ? { borderColor: RANK_ACCENT[pickIdx], color: RANK_ACCENT[pickIdx], background: RANK_ACCENT[pickIdx] + '18' }
                : undefined}
              onClick={() => toggle(o.key)}
              disabled={full}
            >
              {selected && <span className="wf-chip-num">{pickIdx + 1}</span>}
              {o.label}
            </button>
          );
        })}
      </div>

      <div className="wf-pr-actions">
        {onBack && <button className="wf-pr-back" onClick={onBack}>Back</button>}
        <div className="wf-pr-right">
          {onSkip && <button className="wf-pr-skip" onClick={onSkip}>Skip</button>}
          <button className="wf-pr-next" onClick={() => onContinue(picksToTiers(picks))}>
            See my matches →
          </button>
        </div>
      </div>
    </div>
  );
};

const css = `
.wf-pr{font-family:'DM Sans',system-ui,sans-serif;max-width:560px;margin:0 auto;color:#e4e4e7}
.wf-pr h2{font-size:22px;font-weight:800;color:#fafafa;letter-spacing:-.02em;margin:0 0 6px}
.wf-pr-sub{font-size:13px;color:#a1a1aa;line-height:1.5;margin:0 0 18px}
.wf-pr-sub b{color:#fafafa}

/* Order strip */
.wf-pr-order{display:flex;gap:8px;margin-bottom:18px;flex-wrap:wrap}
.wf-pr-slot{display:flex;align-items:center;gap:7px;background:#111113;border:1px solid #27272a;
  border-radius:10px;padding:8px 12px;flex:1 1 120px;min-width:100px;min-height:42px;transition:border-color .15s}
.wf-pr-slot.filled{background:#0e1a14}
.wf-pr-slot-num{font-size:11px;font-weight:800;color:#52525b;min-width:18px;letter-spacing:.02em}
.wf-pr-slot-lbl{font-size:13px;font-weight:600;color:#fafafa;flex:1}
.wf-pr-slot-empty{font-size:12px;color:#3f3f46;flex:1}
.wf-pr-slot-x{background:none;border:none;color:#52525b;cursor:pointer;font-size:11px;padding:0 0 0 4px;
  line-height:1;transition:color .12s}
.wf-pr-slot-x:hover{color:#ef4444}

/* Chips */
.wf-pr-chips{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:4px}
.wf-chip{background:#111113;border:1px solid #27272a;color:#a1a1aa;font-family:inherit;font-size:12.5px;
  font-weight:600;padding:8px 13px;border-radius:20px;cursor:pointer;transition:.12s;
  display:flex;align-items:center;gap:5px}
.wf-chip:hover:not(:disabled){border-color:#3f3f46;color:#e4e4e7}
.wf-chip.dim{opacity:.3;cursor:not-allowed}
.wf-chip-num{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;
  border-radius:50%;background:currentColor;color:#04130c;font-size:10px;font-weight:800;flex-shrink:0}

/* Actions */
.wf-pr-actions{display:flex;justify-content:space-between;align-items:center;margin-top:24px}
.wf-pr-right{display:flex;gap:8px;margin-left:auto}
.wf-pr-back,.wf-pr-skip{background:#18181b;border:1px solid #27272a;color:#a1a1aa;font-family:inherit;
  font-size:14px;font-weight:600;padding:11px 18px;border-radius:10px;cursor:pointer}
.wf-pr-next{background:#10b981;border:none;color:#04130c;font-family:inherit;font-size:14px;
  font-weight:700;padding:11px 22px;border-radius:10px;cursor:pointer;transition:.15s}
.wf-pr-next:hover{background:#34d399}
`;

export default PrioritySelector;
