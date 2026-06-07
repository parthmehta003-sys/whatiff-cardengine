/**
 * ResultsScreenV2.tsx — Stage 1 of the V2 results redesign.
 *
 * Two-column desktop layout (≥820px): left column (sticky) = hero number + card stack/single;
 * right column = placeholder for Stage 2–4 detail panels.
 * Stacks to single column on mobile.
 *
 * Props are identical to ResultsScreen — drop-in swap when all stages are complete.
 * Preview via ?v2 query param (CardEngine gates it).
 *
 * Stage 1 scope: shell, hero numbers, card stack with swap, baseline lines.
 * NOT wired yet: icon rows, detail tabs, alt-card panel, runners-up, insights.
 */
import React, { useState } from 'react';
import type { RankResult, RankedCard, CardMeta, Priorities } from '../../lib/cardEngine/rankCards';
import type { MonthlySpend } from '../../lib/cardEngine/computeEarn';
import type { AlternativeForPriority } from '../../lib/cardEngine/evaluatePriorities';
import { CardTile } from './CardTile';
import type { DevaluationFlag } from './RecommendationCard';
import type { SelectedHack, SurfacedInsight } from '../../lib/cardEngine/selectHacks';

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

interface Props {
  result: RankResult;
  monthlySpend: MonthlySpend;
  isTravelPriority?: boolean;
  devaluations?: Record<string, DevaluationFlag>;
  hacks?: Record<string, SelectedHack | null>;
  intelligence?: Record<string, { type: string; text: string; severity?: string | null }[]>;
  narratives?: Record<string, { topPros: { text: string; valuePerYear: number }[]; topCons: { text: string; valuePerYear: number }[] }>;
  onKnowMore?: (cardId: string) => void;
  insights?: SurfacedInsight[];
  baselineNet?: number;
  liquidity?: Map<string, { aprAnnualPct: number | null; emiConversionAprPct: number | null }>;
  priorities?: Priorities;
  altForTop?: AlternativeForPriority | null;
  onBack?: () => void;
  onRestart?: () => void;
}

export const ResultsScreenV2: React.FC<Props> = ({
  result, baselineNet, onBack, onRestart,
}) => {
  const journeyA = result.journey === 'owns_cards';
  const top = result.recommended[0];
  const comboHero = !journeyA && !!result.combo;
  const heroNet = comboHero ? result.combo!.netPerYear : top?.netGuaranteedPerYear;
  const onTable =
    !journeyA && heroNet != null && baselineNet != null
      ? Math.round(heroNet - baselineNet)
      : null;

  // Which combo card is in the foreground (0 = first card, 1 = second).
  const [frontIdx, setFrontIdx] = useState(0);

  const combo = result.combo ?? null;
  const cardContrib = (c: RankedCard): number => {
    if (!combo) return 0;
    const cats = combo.assignments[c.cardId] ?? [];
    return cats.reduce((s, cat) => s + (c.earn.perCategory[cat]?.guaranteed ?? 0) * 12, 0);
  };

  const front = comboHero && combo ? result.recommended[frontIdx] : null;
  const back  = comboHero && combo ? result.recommended[1 - frontIdx] : null;

  return (
    <div className="r2-shell">
      <style>{css}</style>
      <div className="r2-grid">

        {/* ── LEFT: sticky hero column ── */}
        <div className="r2-left">
          {comboHero && front && back && combo ? (
            /* ── Combo view ── */
            <>
              <div className="r2-eyebrow">Your best combo · both cards</div>
              <div className="r2-hero-num">
                {inr(combo.netPerYear)}<span className="r2-hero-yr">/yr</span>
              </div>
              <div className="r2-hero-sub">combined net benefit across 2 cards</div>

              {/* Stacked cards — back card tappable to swap forward */}
              <div className="r2-stack">
                <div
                  className="r2-card r2-card-back"
                  onClick={() => setFrontIdx((i) => 1 - i)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setFrontIdx((i) => 1 - i); }}
                  aria-label={`Bring ${back.meta.name} to front`}
                >
                  <CardTile cardName={back.meta.name} issuer={(back.meta as CardMeta).bank ?? ''} />
                  <div className="r2-card-body">
                    <div className="r2-card-name">{back.meta.name}</div>
                    <div className="r2-card-cats">{(combo.assignments[back.cardId] ?? []).join(' · ')}</div>
                    <div className="r2-card-val">net for you {inr(cardContrib(back))}/yr</div>
                  </div>
                </div>
                <div className="r2-card r2-card-front">
                  <CardTile cardName={front.meta.name} issuer={(front.meta as CardMeta).bank ?? ''} />
                  <div className="r2-card-body">
                    <div className="r2-card-name">{front.meta.name}</div>
                    <div className="r2-card-cats">{(combo.assignments[front.cardId] ?? []).join(' · ')}</div>
                    <div className="r2-card-val">net for you {inr(cardContrib(front))}/yr</div>
                  </div>
                </div>
              </div>

              {onTable != null && onTable > 0 && (
                <div className="r2-footnote">
                  You&rsquo;re leaving <b>{inr(onTable)}/year</b> on the table with a single card.
                </div>
              )}
            </>
          ) : top ? (
            /* ── Single-card view (Journey B new-card or Journey A owns-cards) ── */
            <>
              <div className="r2-eyebrow">
                {journeyA ? 'Top addition for your setup' : 'Your #1 fit'}
              </div>
              <div className="r2-hero-num">
                {inr(top.netGuaranteedPerYear)}<span className="r2-hero-yr">/yr</span>
              </div>
              <div className="r2-hero-sub">annual net benefit · {top.meta.name}</div>

              <div className="r2-card r2-card-solo">
                <CardTile cardName={top.meta.name} issuer={(top.meta as CardMeta).bank ?? ''} />
                <div className="r2-card-body">
                  <div className="r2-card-name">{top.meta.name}</div>
                  <div className="r2-card-cats">
                    {Object.entries(top.earn.perCategory)
                      .filter(([, v]) => v.guaranteed > 0)
                      .sort(([, a], [, b]) => b.guaranteed - a.guaranteed)
                      .slice(0, 4)
                      .map(([cat]) => cat)
                      .join(' · ')}
                  </div>
                </div>
              </div>

              {/* Baseline line — Journey B only, no combo */}
              {!journeyA && onTable != null && onTable > 0 && (
                <div className="r2-baseline">
                  <span className="r2-baseline-num">{inr(onTable)}</span>
                  <span className="r2-baseline-text">
                    {' '}better/year than an average card you&rsquo;d qualify for
                  </span>
                </div>
              )}
            </>
          ) : null}
        </div>

        {/* ── RIGHT: detail placeholder (Stage 2–4) ── */}
        <div className="r2-right">
          <div className="r2-placeholder">
            <span className="r2-placeholder-label">Detail panels — Stage 2</span>
          </div>
        </div>

      </div>

      {(onBack || onRestart) && (
        <div className="r2-nav">
          {onBack && <button className="r2-back" onClick={onBack}>Back</button>}
          {onRestart && <button className="r2-restart" onClick={onRestart}>Start over</button>}
        </div>
      )}
    </div>
  );
};

const css = `
/* ── Shell & grid ── */
.r2-shell{font-family:'DM Sans',system-ui,sans-serif;color:#e4e4e7;max-width:920px;margin:0 auto}
.r2-grid{display:grid;grid-template-columns:360px 1fr;gap:36px;align-items:start}
@media(max-width:820px){.r2-grid{grid-template-columns:1fr}}

/* ── Left column — sticky ── */
.r2-left{position:sticky;top:28px;display:flex;flex-direction:column}
@media(max-width:820px){.r2-left{position:static}}

/* ── Eyebrow + hero number ── */
.r2-eyebrow{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#52525b;margin-bottom:10px}
.r2-hero-num{font-size:44px;font-weight:800;color:#10b981;letter-spacing:-.03em;line-height:1;font-variant-numeric:tabular-nums;margin-bottom:5px}
.r2-hero-yr{font-size:24px;font-weight:700;color:#34d399;letter-spacing:0;margin-left:1px}
.r2-hero-sub{font-size:13px;color:#71717a;margin-bottom:20px;line-height:1.4}

/* ── Card base ── */
.r2-card{background:#111113;border:1px solid #27272a;border-radius:14px;overflow:hidden}
.r2-card-body{padding:13px 15px 15px}
.r2-card-name{font-size:15px;font-weight:700;color:#fafafa;margin-bottom:5px}
.r2-card-cats{font-size:12px;color:#52525b;line-height:1.5;margin-bottom:7px}
.r2-card-val{font-size:12.5px;font-weight:700;color:#34d399;font-variant-numeric:tabular-nums}

/* ── Solo card ── */
.r2-card-solo{margin-bottom:16px}

/* ── Card stack (combo) ── */
/* Container adds top + right padding so the back card can peek above and right of the front. */
.r2-stack{position:relative;padding-top:14px;padding-right:20px;margin-bottom:18px}

/* Back card: absolutely positioned at top-right, scaled down, muted. */
.r2-card-back{
  position:absolute;top:0;right:0;left:20px;
  transform:scale(0.93);transform-origin:top right;
  opacity:0.5;z-index:0;
  cursor:pointer;outline:none;
  transition:opacity .18s,transform .2s;
}
.r2-card-back:hover,.r2-card-back:focus-visible{opacity:0.85;transform:scale(0.96)}

/* Front card: normal flow, fills the padding-narrowed width. */
.r2-card-front{position:relative;z-index:1}

/* ── Combo footnote ── */
.r2-footnote{font-size:12.5px;color:#6b7280;line-height:1.55}
.r2-footnote b{color:#10b981;font-weight:700;font-variant-numeric:tabular-nums}

/* ── Single-card baseline line ── */
.r2-baseline{display:flex;align-items:baseline;flex-wrap:wrap;gap:5px;margin-top:2px}
.r2-baseline-num{font-size:22px;font-weight:800;color:#10b981;font-variant-numeric:tabular-nums;line-height:1.1}
.r2-baseline-text{font-size:13px;color:#71717a;line-height:1.5}

/* ── Right placeholder ── */
.r2-placeholder{border:1px dashed #27272a;border-radius:14px;padding:48px 24px;
  display:flex;align-items:center;justify-content:center;min-height:220px}
.r2-placeholder-label{font-size:11px;font-weight:700;text-transform:uppercase;
  letter-spacing:.08em;color:#3f3f46}

/* ── Nav ── */
.r2-nav{display:flex;gap:8px;margin-top:32px}
.r2-back{flex:1;background:#1c1c20;border:1px solid #3f3f46;color:#fafafa;
  font-family:inherit;font-size:13px;font-weight:700;padding:11px;border-radius:10px;cursor:pointer}
.r2-restart{flex:1;background:#141417;border:1px solid #2a2a30;color:#a1a1aa;
  font-family:inherit;font-size:13px;font-weight:600;padding:11px;border-radius:10px;cursor:pointer}
`;

export default ResultsScreenV2;
