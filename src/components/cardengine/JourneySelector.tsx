/**
 * JourneySelector.tsx — first screen (Spec A1). Forks the flow:
 *   B ("new_card")  — I want a card / my first card
 *   A ("owns_cards") — I already have card(s); are they right?
 *
 * Styling: WhatIff tokens (dark zinc, DM Sans, emerald/purple accents).
 */
import React from 'react';
import type { Journey } from '../../lib/cardEngine/rankCards';

interface Props { onSelect: (j: Journey) => void; }

export const JourneySelector: React.FC<Props> = ({ onSelect }) => (
  <div className="wf-js">
    <style>{css}</style>
    <div className="wf-js-kicker">WhatIff Card Engine</div>
    <h1 className="wf-js-title">Find the card that actually fits your spending.</h1>
    <p className="wf-js-sub">
      We evaluate 40 cards against how you really spend — and show you the math, not marketing.
    </p>

    <div className="wf-js-cards">
      <button className="wf-js-card wf-js-b" onClick={() => onSelect('new_card')}>
        <span className="wf-js-emoji">✦</span>
        <span className="wf-js-h">I want a new card</span>
        <span className="wf-js-d">First card, or adding one. We&rsquo;ll rank the best fits for your spend.</span>
        <span className="wf-js-go">Get matched →</span>
      </button>

      <button className="wf-js-card wf-js-a" onClick={() => onSelect('owns_cards')}>
        <span className="wf-js-emoji">↻</span>
        <span className="wf-js-h">I already have card(s)</span>
        <span className="wf-js-d">Are yours right for your spending — or are you leaving money on the table?</span>
        <span className="wf-js-go">Check my cards →</span>
      </button>
    </div>

    <div className="wf-js-foot">Proprietary matching engine · no affiliate ranking · your data stays on-device</div>
  </div>
);

const css = `
.wf-js{font-family:'DM Sans',system-ui,sans-serif;max-width:560px;margin:0 auto;color:#e4e4e7;text-align:center;padding:8px}
.wf-js-kicker{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#10b981;margin-bottom:14px}
.wf-js-title{font-size:30px;font-weight:800;color:#fafafa;letter-spacing:-.03em;line-height:1.1;margin:0 0 12px}
.wf-js-sub{font-size:14px;color:#a1a1aa;line-height:1.55;margin:0 auto 28px;max-width:430px}
.wf-js-cards{display:flex;flex-direction:column;gap:12px;text-align:left}
.wf-js-card{display:flex;flex-direction:column;background:#0c0c0e;border:1px solid #1f1f23;border-radius:16px;
  padding:20px;cursor:pointer;font-family:inherit;transition:border-color .15s,transform .1s,background .15s;position:relative}
.wf-js-card:hover{transform:translateY(-2px)}
.wf-js-b:hover{border-color:#10b981;background:#0a1410}
.wf-js-a:hover{border-color:#8b5cf6;background:#100c1a}
.wf-js-emoji{font-size:22px;margin-bottom:10px}
.wf-js-b .wf-js-emoji{color:#10b981}.wf-js-a .wf-js-emoji{color:#8b5cf6}
.wf-js-h{font-size:18px;font-weight:700;color:#fafafa;margin-bottom:5px}
.wf-js-d{font-size:13px;color:#a1a1aa;line-height:1.5;margin-bottom:14px}
.wf-js-go{font-size:13px;font-weight:700}
.wf-js-b .wf-js-go{color:#10b981}.wf-js-a .wf-js-go{color:#a78bfa}
.wf-js-foot{margin-top:24px;font-size:11px;color:#52525b}
`;

export default JourneySelector;
