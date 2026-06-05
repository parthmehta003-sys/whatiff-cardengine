/**
 * RecommendationCard.tsx — the hero per-card result block (Spec §8.1–8.5).
 *
 * Layout: card image · annual fee + waiver · annual net benefit · expandable math breakdown ·
 * why-it-works / what-to-watch (rupee-grounded) · invite-only badge · devaluation flag.
 *
 * ALL numbers come from the engine (RankedCard). This component formats and arranges; it never
 * computes rupee values. The prose ("why it works") slots are filled by the AI layer in Phase 3 —
 * here they render from engine-produced `notes` and a deterministic fallback so the card is fully
 * functional WITHOUT the AI (AI only polishes the wording, never supplies numbers).
 *
 * Styling: WhatIff tokens (dark zinc #09090b, DM Sans, accents).
 */

import React, { useState } from 'react';
import type { RankedCard } from '../../lib/cardEngine/rankCards';
import type { SpendCategory } from '../../lib/cardEngine/computeEarn';
import CardMathBreakdown from './CardMathBreakdown';
import CardTile from './CardTile';

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

export interface DevaluationFlag {
  whatChanged: string;     // e.g. "Sony LIV renewal benefit removed 1 April 2026"
  marketingClaim?: string; // e.g. "Axis still markets a Sony LIV benefit"
}

interface Props {
  card: RankedCard;
  monthlySpend: Partial<Record<SpendCategory, number>>;
  rank?: number;                  // 1-based position, for the badge
  imageUrl?: string;
  applyUrl?: string;
  forexPct?: number;              // for travel-card forex-vs-benchmark line
  isTravelPriority?: boolean;
  devaluation?: DevaluationFlag;  // §8.5 — the hero demo when present
  /** AI-written prose; if absent, deterministic fallback prose is used. */
  whyItWorks?: string;
  whatToWatch?: string;
  /** Structured hack (from selectHacks) — full framework, three-layer display. */
  hack?: {
    name: string;
    whyItMatters: string;
    executionSteps?: string | null;
    difficulty?: string | null;
    status?: string | null;
    commonFailure?: string | null;
    lastVerified?: string | null;
    matchedOnSpend?: boolean;
  };
  /** Layer 3 — "Things to Know" intelligence items (benefit changes, devaluations, hidden perks). */
  intelligence?: { type: string; text: string; severity?: string | null }[];
  /** Value-first pros/cons (from buildCardNarrative). */
  narrative?: {
    topPros: { text: string; valuePerYear: number }[];
    topCons: { text: string; valuePerYear: number }[];
  };
  /** opens the full Excel pros/cons list (separate view). */
  onKnowMore?: () => void;
  hackLine?: string;
  /** invite path text for invite-only cards (replaces Apply). */
  inviteHowTo?: string;
  /** true when this card is part of a two-card combo — changes net label to "on its own" */
  isInCombo?: boolean;
}

const FOREX_BENCHMARK = 3.5;

export const RecommendationCard: React.FC<Props> = ({
  card, monthlySpend, rank, imageUrl, applyUrl, forexPct,
  isTravelPriority, devaluation, whyItWorks, whatToWatch, hack, intelligence, narrative, onKnowMore, hackLine, inviteHowTo, isInCombo,
}) => {
  const [open, setOpen] = useState(false);
  const [hackOpen, setHackOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<null | 'value' | 'hack' | 'math' | 'know'>(null);
  const m = card.meta;

  // Deterministic fallback prose (used until AI layer fills these). Rupee-grounded, from engine.
  const topCats = (Object.keys(card.earn.perCategory) as SpendCategory[])
    .map((c) => ({ c, v: card.earn.perCategory[c].guaranteed * 12 }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v)
    .slice(0, 2);
  const fallbackWorks =
    topCats.length > 0
      ? `Earns most on your ${topCats.map((t) => `${t.c === 'Other(base)' ? 'everyday' : t.c.toLowerCase()} spend (${inr(t.v)}/yr)`).join(' and ')}.`
      : 'A solid all-round earner for your spending pattern.';

  // largest leakage for the "what to watch" fallback
  const leak = (Object.keys(card.earn.perCategory) as SpendCategory[])
    .map((c) => card.earn.perCategory[c])
    .filter((ce) => ce.excluded || ce.capHit)
    .sort((a, b) => (b.rawBeforeCap - b.guaranteed) - (a.rawBeforeCap - a.guaranteed))[0];
  const fallbackWatch = leak
    ? leak.excluded
      ? `${leak.category} spend earns nothing on this card — route it elsewhere.`
      : `You hit the ${leak.category} cap — ${inr((leak.rawBeforeCap - leak.guaranteed) * 12)}/yr of reward is lost above it.`
    : card.effectiveAnnualFee > 0
      ? `The ${inr(card.effectiveAnnualFee)} annual fee applies unless you clear the waiver spend.`
      : 'No major caveats for your spending pattern.';

  return (
    <div className={'wf-rec' + (card.inviteOnly ? ' wf-rec-isinvite' : '')}>
      <style>{css}</style>

      {/* invite-only ribbon — prominent, top of card */}
      {card.inviteOnly && (
        <div className="wf-rec-ribbon">
          <span className="wf-rec-ribbon-ic">✦</span>
          Invite only — banks offer this by invitation, not open application
        </div>
      )}

      {/* header: image + identity + net */}
      <div className="wf-rec-head">
        <div className="wf-rec-img">
          <CardTile cardName={m.name} issuer={m.bank} />
        </div>

        <div className="wf-rec-id">
          <div className="wf-rec-rankrow">
            {rank && <span className="wf-rec-rank">#{rank} fit</span>}
          </div>
          <div className="wf-rec-name">{m.name}</div>
          <div className="wf-rec-fee">
            {m.annualFee === 0 ? (
              <span className="wf-ltf">Lifetime Free</span>
            ) : card.effectiveAnnualFee === 0 ? (
              <>
                <span className="wf-feestrike">{inr(m.annualFee)}/yr</span>
                <span className="wf-feewaived">waived at {inr(m.feeWaiverSpend)} spend</span>
              </>
            ) : (
              <>Annual fee {inr(m.annualFee)}{m.feeWaiverSpend > 0 && <> · waived at {inr(m.feeWaiverSpend)}</>}</>
            )}
          </div>
        </div>

        <div className="wf-rec-net">
          <div className="wf-rec-net-label">{isInCombo ? 'on its own' : 'annual net'}</div>
          <div className="wf-rec-net-val">{inr(card.netGuaranteedPerYear)}</div>
          {card.annualUpside > 0 && (
            <div className="wf-rec-net-up">+{inr(card.annualUpside)} portal upside</div>
          )}
        </div>
      </div>

      {/* ── DEFAULT (calm) STATE: just the headline reason + one flag if critical ── */}
      {devaluation && (
        <div className="wf-deval wf-deval-compact">
          <span className="wf-deval-tag">we caught this</span>
          {devaluation.whatChanged}
        </div>
      )}

      <div className="wf-headline">
        <span className="wf-headline-k">Best for</span>
        <span className="wf-headline-v">{whyItWorks ?? fallbackWorks}</span>
      </div>

      {/* one-line peek at the single biggest watch-out, if any */}
      {(whatToWatch ?? fallbackWatch) && (
        <div className="wf-watchline">{whatToWatch ?? fallbackWatch}</div>
      )}

      {/* ── DETAIL DRAWER: collapsed by default, tabbed when open ── */}
      <div className="wf-detail">
        <div className="wf-detail-tabs">
          {narrative && (narrative.topPros.length > 0 || narrative.topCons.length > 0) && (
            <button className={detailTab === 'value' ? 'on' : ''} onClick={() => setDetailTab((t) => t === 'value' ? null : 'value')}>
              Gains &amp; costs
            </button>
          )}
          {(hack || hackLine) && (
            <button className={detailTab === 'hack' ? 'on' : ''} onClick={() => setDetailTab((t) => t === 'hack' ? null : 'hack')}>
              ★ Hack
            </button>
          )}
          <button className={detailTab === 'math' ? 'on' : ''} onClick={() => setDetailTab((t) => t === 'math' ? null : 'math')}>
            The math
          </button>
          {intelligence && intelligence.length > 0 && (
            <button className={detailTab === 'know' ? 'on' : ''} onClick={() => setDetailTab((t) => t === 'know' ? null : 'know')}>
              Things to know{intelligence.length > 0 ? ` (${intelligence.length})` : ''}
            </button>
          )}
        </div>

        {detailTab === 'value' && narrative && (
          <div className="wf-detail-body">
            <div className="wf-pc">
              {narrative.topPros.length > 0 && (
                <div className="wf-pc-col">
                  <div className="wf-pc-h wf-pc-pro">What you gain</div>
                  <ul className="wf-pc-prolist">{narrative.topPros.map((p, i) => <li key={i}>{p.text}</li>)}</ul>
                </div>
              )}
              {narrative.topCons.length > 0 && (
                <div className="wf-pc-col">
                  <div className="wf-pc-h wf-pc-con">What it costs you</div>
                  <ul className="wf-pc-conlist">{narrative.topCons.map((c, i) => <li key={i}>{c.text}</li>)}</ul>
                </div>
              )}
              {onKnowMore && (
                <button className="wf-pc-more" onClick={onKnowMore}>See all pros &amp; cons →</button>
              )}
            </div>
          </div>
        )}

        {detailTab === 'hack' && (hack || hackLine) && (
          <div className="wf-detail-body">
            <div className="wf-hackbox">
              <div className="wf-hackbox-head">
                {hack?.difficulty && <span className="wf-hack-diff">{hack.difficulty}</span>}
                {hack?.status && (
                  <span className={'wf-hack-st ' + (/active/i.test(hack.status) && !/fading/i.test(hack.status) ? 'live' : 'fading')}>
                    {/active/i.test(hack.status) && !/fading/i.test(hack.status) ? 'Active' : hack.status}
                  </span>
                )}
              </div>
              {hack ? (
                <>
                  <div className="wf-hack-name2">{hack.name}</div>
                  <div className="wf-hack-why2">{hack.whyItMatters}</div>
                  {hack.executionSteps && (
                    <>
                      <button className="wf-hack-toggle" onClick={() => setHackOpen((v) => !v)}>
                        {hackOpen ? '▲ hide steps' : 'See how →'}
                      </button>
                      {hackOpen && (
                        <div className="wf-hack-detail">
                          <div className="wf-hack-steps-h">How to do it</div>
                          <div className="wf-hack-steps">{hack.executionSteps}</div>
                          {hack.commonFailure && (
                            <div className="wf-hack-fail"><span>Common failure</span> {hack.commonFailure}</div>
                          )}
                          {hack.lastVerified && <div className="wf-hack-verified">Last verified {hack.lastVerified}</div>}
                        </div>
                      )}
                    </>
                  )}
                </>
              ) : (
                <div className="wf-hack-why2">{hackLine}</div>
              )}
            </div>
          </div>
        )}

        {detailTab === 'math' && (
          <div className="wf-detail-body">
            <CardMathBreakdown
              earn={card.earn}
              effectiveAnnualFee={card.effectiveAnnualFee}
              annualFee={m.annualFee}
              feeWaiverSpend={m.feeWaiverSpend}
              netGuaranteedPerYear={card.netGuaranteedPerYear}
              annualUpside={card.annualUpside}
              monthlySpend={monthlySpend}
            />
          </div>
        )}

        {detailTab === 'know' && intelligence && (
          <div className="wf-detail-body">
            <ul className="wf-intel-list">
              {intelligence.map((it, i) => <li key={i} className={'wf-intel-' + it.type}>{it.text}</li>)}
            </ul>
          </div>
        )}
      </div>

      {/* CTA */}
      <div className="wf-cta">
        {card.inviteOnly ? (
          <div className="wf-cta-invite">
            {inviteHowTo ?? 'Invite-only — typically offered to existing premium customers or on upgrade.'}
          </div>
        ) : (
          <a className="wf-cta-btn" href={applyUrl ?? '#'} target="_blank" rel="noreferrer">
            Apply on {m.bank} →
          </a>
        )}
      </div>
    </div>
  );
};

const css = `
.wf-rec{font-family:'DM Sans',system-ui,sans-serif;background:#09090b;border:1px solid #1f1f23;
  border-radius:18px;padding:18px;color:#e4e4e7;max-width:560px;
  box-shadow:0 1px 0 rgba(255,255,255,.02) inset,0 8px 30px rgba(0,0,0,.4)}
.wf-rec-isinvite{border-color:#3b2f63;padding-top:0;overflow:hidden}
.wf-rec-ribbon{margin:-18px -18px 16px;padding:9px 16px;background:#160f2b;border-bottom:1px solid #3b2f63;
  color:#c4b5fd;font-size:11.5px;font-weight:600;display:flex;align-items:center;gap:8px;line-height:1.35}
.wf-rec-ribbon-ic{color:#a78bfa;font-size:13px;flex:0 0 auto}
.wf-rec-head{display:flex;gap:14px;align-items:flex-start}
.wf-rec-img{flex:0 0 78px;width:78px;height:50px;border-radius:8px;overflow:hidden;
  background:#18181b;border:1px solid #27272a;display:flex;align-items:center;justify-content:center}
.wf-rec-img img{width:100%;height:100%;object-fit:cover}
.wf-rec-img-ph{font-size:20px;font-weight:800;color:#3f3f46}
.wf-rec-id{flex:1;min-width:0}
.wf-rec-rankrow{display:flex;gap:7px;align-items:center;margin-bottom:3px}
.wf-rec-rank{font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
  color:#10b981;border:1px solid #134e34;background:#0a1f16;border-radius:5px;padding:2px 6px}
.wf-rec-invite{font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
  color:#a78bfa;border:1px solid #3b2f63;background:#161029;border-radius:5px;padding:2px 6px}
.wf-rec-name{font-size:17px;font-weight:700;color:#fafafa;letter-spacing:-.01em;line-height:1.2}
.wf-rec-fee{font-size:12px;color:#71717a;margin-top:3px;display:flex;gap:7px;flex-wrap:wrap;align-items:baseline}
.wf-ltf{color:#10b981;font-weight:600}
.wf-feestrike{text-decoration:line-through;color:#52525b}
.wf-feewaived{color:#10b981;font-weight:600}
.wf-rec-net{flex:0 0 auto;text-align:right}
.wf-rec-net-label{font-size:9.5px;text-transform:uppercase;letter-spacing:.06em;color:#52525b;font-weight:600}
.wf-rec-net-val{font-size:26px;font-weight:800;color:#10b981;letter-spacing:-.02em;
  font-variant-numeric:tabular-nums;line-height:1.1}
.wf-rec-net-up{font-size:10.5px;color:#f59e0b;font-weight:600;margin-top:1px}
.wf-deval{margin-top:14px;font-size:12px;line-height:1.55;color:#fca5a5;
  background:#1a0f0f;border:1px solid #4c1d1d;border-radius:10px;padding:10px 12px}
.wf-deval-tag{display:inline-block;font-size:9px;font-weight:800;text-transform:uppercase;
  letter-spacing:.06em;color:#ef4444;border:1px solid #7f1d1d;border-radius:4px;padding:1px 5px;margin-right:7px}
.wf-forex{margin-top:12px;font-size:12px;color:#34d399;background:#0a1f16;
  border:1px solid #134e34;border-radius:9px;padding:8px 11px}
.wf-prose{margin-top:14px;display:flex;flex-direction:column;gap:9px}
.wf-prose-row{display:grid;grid-template-columns:92px 1fr;gap:10px;font-size:12.5px;line-height:1.5}
.wf-prose-k{font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;
  color:#52525b;padding-top:2px}
.wf-deval-compact{margin-top:12px;font-size:11.5px;padding:8px 11px}
.wf-headline{margin-top:14px;display:flex;flex-direction:column;gap:3px}
.wf-headline-k{font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#52525b}
.wf-headline-v{font-size:14px;color:#e4e4e7;line-height:1.5;font-weight:500}
.wf-watchline{margin-top:9px;font-size:12px;color:#a1a1aa;line-height:1.45;padding-left:13px;position:relative}
.wf-watchline:before{content:'!';position:absolute;left:0;color:#f59e0b;font-weight:800}
.wf-detail{margin-top:14px;border-top:1px solid #1f1f23;padding-top:12px}
.wf-detail-tabs{display:flex;flex-wrap:wrap;gap:6px}
.wf-detail-tabs button{background:#111113;border:1px solid #27272a;color:#a1a1aa;font-family:inherit;
  font-size:12px;font-weight:600;padding:7px 12px;border-radius:8px;cursor:pointer;transition:.12s}
.wf-detail-tabs button:hover{border-color:#3f3f46;color:#e4e4e7}
.wf-detail-tabs button.on{background:#0a1410;border-color:#10b981;color:#34d399}
.wf-detail-body{margin-top:12px;animation:wf-detail-in .2s ease}
@keyframes wf-detail-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.wf-intel-head{display:none}
.wf-pc{margin-top:13px;display:grid;grid-template-columns:1fr 1fr;gap:12px}
.wf-pc-col{min-width:0}
.wf-pc-h{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;margin-bottom:7px}
.wf-pc-pro{color:#34d399}
.wf-pc-con{color:#f59e0b}
.wf-pc-col ul{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}
.wf-pc-col li{font-size:12px;color:#d4d4d8;line-height:1.45;padding-left:15px;position:relative}
.wf-pc-prolist li:before{content:'+';position:absolute;left:2px;color:#10b981;font-weight:800}
.wf-pc-conlist li:before{content:'−';position:absolute;left:2px;color:#f59e0b;font-weight:800}
.wf-pc-more{grid-column:1 / -1;background:#111113;border:1px solid #27272a;color:#a1a1aa;font-family:inherit;
  font-size:12px;font-weight:600;padding:9px;border-radius:9px;cursor:pointer;transition:.15s}
.wf-pc-more:hover{background:#18181b;border-color:#3f3f46;color:#e4e4e7}
.wf-hackbox{margin-top:13px;background:#14110a;border:1px solid #3a2f12;border-radius:12px;padding:13px 14px}
.wf-hackbox-head{display:flex;align-items:center;gap:8px;margin-bottom:7px}
.wf-hackbox-tag{font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#fbbf24}
.wf-hack-diff{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#a1a1aa;border:1px solid #3f3f46;border-radius:4px;padding:1px 6px}
.wf-hack-st{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;border-radius:4px;padding:1px 6px}
.wf-hack-st.live{color:#34d399;border:1px solid #1a6b46}
.wf-hack-st.fading{color:#f59e0b;border:1px solid #6b5410}
.wf-hack-name2{font-size:14.5px;font-weight:700;color:#fde68a;margin-bottom:3px}
.wf-hack-why2{font-size:12.5px;color:#d4d4d8;line-height:1.5}
.wf-hack-toggle{margin-top:9px;background:none;border:none;color:#fbbf24;font-family:inherit;font-size:12px;font-weight:700;cursor:pointer;padding:0}
.wf-hack-detail{margin-top:10px;padding-top:11px;border-top:1px solid #3a2f12}
.wf-hack-steps-h{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#a1a1aa;margin-bottom:5px}
.wf-hack-steps{font-size:12.5px;color:#e4e4e7;line-height:1.6;white-space:pre-line}
.wf-hack-fail{margin-top:10px;font-size:12px;color:#fca5a5;line-height:1.5;background:#1a0f0f;border:1px solid #4c1d1d;border-radius:8px;padding:8px 10px}
.wf-hack-fail span{font-weight:700;text-transform:uppercase;font-size:9px;letter-spacing:.05em;color:#f87171;margin-right:6px}
.wf-hack-verified{margin-top:8px;font-size:10.5px;color:#71717a}
.wf-intel{margin-top:12px;background:#0e0e11;border:1px solid #2a2a30;border-radius:12px;padding:13px 14px}
.wf-intel-head{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#a1a1aa;margin-bottom:9px}
.wf-intel-list{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:7px}
.wf-intel-list li{font-size:12.5px;color:#d4d4d8;line-height:1.5;padding-left:18px;position:relative}
.wf-intel-list li:before{content:'•';position:absolute;left:4px;color:#52525b}
.wf-intel-devaluation:before{content:'⚠';color:#f59e0b !important;left:2px}
.wf-intel-benefit_change:before{content:'↻';color:#06b6d4 !important;left:2px}
.wf-intel-hidden_benefit:before{content:'✦';color:#10b981 !important;left:2px}
.wf-toggle{margin-top:15px;width:100%;background:#111113;border:1px solid #27272a;color:#a1a1aa;
  font-family:inherit;font-size:12px;font-weight:600;padding:9px;border-radius:9px;cursor:pointer;
  transition:background .15s,border-color .15s}
.wf-toggle:hover{background:#18181b;border-color:#3f3f46;color:#e4e4e7}
.wf-cta{margin-top:14px}
.wf-cta-btn{display:block;text-align:center;background:#10b981;color:#04130c;font-weight:700;
  font-size:14px;text-decoration:none;padding:12px;border-radius:10px;transition:background .15s}
.wf-cta-btn:hover{background:#34d399}
.wf-cta-invite{text-align:center;font-size:12px;color:#a78bfa;background:#100b1f;
  border:1px solid #3b2f63;border-radius:10px;padding:11px;line-height:1.5}
`;

export default RecommendationCard;
