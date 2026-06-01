/**
 * OwnedCardSelector.tsx — Journey A only (Spec A1). Multi-select of cards the user already holds,
 * from the 40 in the DB. Comes FIRST in Journey A (before spend), per the step-ordering decision.
 */
import React, { useMemo, useState } from 'react';
import type { CardMeta } from '../../lib/cardEngine/rankCards';

interface Props {
  cards: CardMeta[];
  initial?: string[];
  onContinue: (ownedIds: string[]) => void;
  onBack?: () => void;
}

export const OwnedCardSelector: React.FC<Props> = ({ cards, initial, onContinue, onBack }) => {
  const [sel, setSel] = useState<Set<string>>(new Set(initial ?? []));
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = t ? cards.filter((c) => c.name.toLowerCase().includes(t) || c.bank.toLowerCase().includes(t)) : cards;
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [cards, q]);

  const toggle = (id: string) =>
    setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className="wf-oc">
      <style>{css}</style>
      <h2>Which cards do you already have?</h2>
      <p className="wf-oc-sub">We&rsquo;ll check whether they fit your spending — and whether adding one would beat your current setup.</p>

      <input className="wf-oc-search" placeholder="Search by card or bank…" value={q} onChange={(e) => setQ(e.target.value)} />

      {sel.size > 0 && (
        <div className="wf-oc-chips">
          {[...sel].map((id) => {
            const c = cards.find((x) => x.cardId === id);
            return <span key={id} className="wf-oc-chip" onClick={() => toggle(id)}>{c?.name} ✕</span>;
          })}
        </div>
      )}

      <div className="wf-oc-list">
        {filtered.map((c) => (
          <button key={c.cardId} className={'wf-oc-item' + (sel.has(c.cardId) ? ' on' : '')} onClick={() => toggle(c.cardId)}>
            <span className="wf-oc-check">{sel.has(c.cardId) ? '✓' : ''}</span>
            <span className="wf-oc-name">{c.name}</span>
            <span className="wf-oc-bank">{c.bank}{c.annualFee === 0 ? ' · LTF' : ` · ₹${c.annualFee.toLocaleString('en-IN')}`}</span>
          </button>
        ))}
      </div>

      <div className="wf-oc-actions">
        {onBack && <button className="wf-oc-back" onClick={onBack}>Back</button>}
        <button className="wf-oc-next" disabled={sel.size === 0} onClick={() => onContinue([...sel])}>
          Continue ({sel.size}) →
        </button>
      </div>
    </div>
  );
};

const css = `
.wf-oc{font-family:'DM Sans',system-ui,sans-serif;max-width:560px;margin:0 auto;color:#e4e4e7}
.wf-oc h2{font-size:22px;font-weight:800;color:#fafafa;letter-spacing:-.02em;margin:0 0 6px}
.wf-oc-sub{font-size:13px;color:#a1a1aa;line-height:1.5;margin:0 0 16px}
.wf-oc-search{width:100%;background:#111113;border:1px solid #27272a;color:#fafafa;font-family:inherit;
  font-size:14px;padding:12px 14px;border-radius:10px;outline:none;box-sizing:border-box}
.wf-oc-search::placeholder{color:#52525b}
.wf-oc-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
.wf-oc-chip{background:#100c1a;border:1px solid #3b2f63;color:#c4b5fd;font-size:12px;font-weight:600;
  padding:5px 10px;border-radius:16px;cursor:pointer}
.wf-oc-list{margin-top:12px;display:flex;flex-direction:column;gap:6px;max-height:380px;overflow-y:auto}
.wf-oc-item{display:flex;align-items:center;gap:11px;background:#0c0c0e;border:1px solid #1f1f23;
  border-radius:10px;padding:12px 14px;cursor:pointer;font-family:inherit;text-align:left;transition:.12s}
.wf-oc-item:hover{border-color:#3f3f46}
.wf-oc-item.on{background:#100c1a;border-color:#8b5cf6}
.wf-oc-check{width:18px;height:18px;border-radius:5px;border:1px solid #3f3f46;display:flex;align-items:center;
  justify-content:center;font-size:12px;color:#a78bfa;flex:0 0 auto}
.wf-oc-item.on .wf-oc-check{background:#8b5cf6;border-color:#8b5cf6;color:#0c0612}
.wf-oc-name{font-size:14px;font-weight:600;color:#fafafa;flex:1}
.wf-oc-bank{font-size:11px;color:#71717a}
.wf-oc-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:18px}
.wf-oc-back{background:#18181b;border:1px solid #27272a;color:#a1a1aa;font-family:inherit;font-size:14px;font-weight:600;padding:11px 18px;border-radius:10px;cursor:pointer}
.wf-oc-next{background:#8b5cf6;border:none;color:#0c0612;font-family:inherit;font-size:14px;font-weight:700;padding:11px 22px;border-radius:10px;cursor:pointer;transition:.15s}
.wf-oc-next:disabled{background:#241b38;color:#5b4d7a;cursor:not-allowed}
.wf-oc-next:not(:disabled):hover{background:#a78bfa}
`;

export default OwnedCardSelector;
