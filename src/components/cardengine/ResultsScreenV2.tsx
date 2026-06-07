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
 * Card composition matches whatiff_results_prototype.html exactly:
 *   chip → pc-name → pc-cats → pc-net (absolute bottom-left) → pc-sheen
 *   all rendered INSIDE the gradient card, no block below the tile.
 *
 * Stage 1 scope: shell, hero numbers, card stack with swap, baseline lines.
 * NOT wired yet: icon rows, detail tabs, alt-card panel, runners-up, insights.
 */
import React, { useState } from 'react';
import type { RankResult, RankedCard, CardMeta, Priorities } from '../../lib/cardEngine/rankCards';
import type { MonthlySpend } from '../../lib/cardEngine/computeEarn';
import type { AlternativeForPriority } from '../../lib/cardEngine/evaluatePriorities';
import { resolveTileColor } from './CardTile';
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

/** A single gradient card matching the prototype .pcard composition exactly. */
const PCard: React.FC<{
  card: RankedCard;
  cats: string;
  net: number;
  className?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  role?: string;
  tabIndex?: number;
  'aria-label'?: string;
}> = ({ card, cats, net, className = '', style, onClick, onKeyDown, role, tabIndex, 'aria-label': ariaLabel }) => {
  const { from, to } = resolveTileColor(card.meta.name, (card.meta as CardMeta).bank ?? '');
  return (
    <div
      className={'r2-pcard ' + className}
      style={{ background: `linear-gradient(150deg,${from},${to})`, ...style }}
      onClick={onClick}
      onKeyDown={onKeyDown}
      role={role}
      tabIndex={tabIndex}
      aria-label={ariaLabel}
    >
      <div className="r2-chip" />
      <div className="r2-pc-name">{card.meta.name}</div>
      <div className="r2-pc-cats">{cats}</div>
      <div className="r2-pc-net">net for you <b>{inr(net)}/yr</b></div>
      <div className="r2-pc-sheen" />
    </div>
  );
};

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

  // Which combo card is in the foreground (0 = first recommended, 1 = second).
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
              <div className="r2-hero-sub">
                combined net benefit across <b>2 cards</b>
              </div>

              {/* Card stack — prototype: back at translate(34px,64px) scale(.93), front at 0/0 scale(1) */}
              <div className="r2-stack">
                {/* Back card — tappable to swap forward */}
                <PCard
                  card={back}
                  cats={(combo.assignments[back.cardId] ?? []).join(' · ')}
                  net={cardContrib(back)}
                  className="r2-pcard-back"
                  onClick={() => setFrontIdx(i => 1 - i)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setFrontIdx(i => 1 - i); }}
                  role="button"
                  tabIndex={0}
                  aria-label={`Bring ${back.meta.name} to front`}
                />
                {/* Front card */}
                <PCard
                  card={front}
                  cats={(combo.assignments[front.cardId] ?? []).join(' · ')}
                  net={cardContrib(front)}
                  className="r2-pcard-front"
                />
              </div>

              <div className="r2-swaphint">
                Showing <b>{front.meta.name}</b> · tap the other card to swap
              </div>

              {onTable != null && onTable > 0 && (
                <div className="r2-footnote">
                  You&rsquo;re leaving <b>{inr(onTable)}/year</b> on the table with a single card.
                </div>
              )}
            </>
          ) : top ? (
            /* ── Single-card view ── */
            <>
              <div className="r2-eyebrow">
                {journeyA ? 'Top addition for your setup' : 'Your #1 fit'}
              </div>
              <div className="r2-hero-num">
                {inr(top.netGuaranteedPerYear)}<span className="r2-hero-yr">/yr</span>
              </div>
              <div className="r2-hero-sub">
                annual net benefit · <b>{top.meta.name}</b>
              </div>

              {/* Single card — same .pcard composition, normal flow */}
              <div className="r2-solo-stack">
                <PCard
                  card={top}
                  cats={
                    Object.entries(top.earn.perCategory)
                      .filter(([, v]) => v.guaranteed > 0)
                      .sort(([, a], [, b]) => b.guaranteed - a.guaranteed)
                      .slice(0, 4)
                      .map(([cat]) => cat)
                      .join(' · ')
                  }
                  net={top.netGuaranteedPerYear}
                  className="r2-pcard-solo"
                />
              </div>

              {/* Baseline line — Journey B only, no combo */}
              {!journeyA && onTable != null && onTable > 0 && (
                <div className="r2-betterline">
                  <b>{inr(onTable)}</b> better/year than an average card you&rsquo;d qualify for
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
/* ── Shell & grid — matches prototype .shell ── */
.r2-shell{font-family:'DM Sans',system-ui,sans-serif;color:#fafafa;max-width:1080px;margin:0 auto}
.r2-grid{display:grid;grid-template-columns:380px 1fr;gap:32px;align-items:start}
@media(max-width:820px){.r2-grid{grid-template-columns:1fr}}

/* ── Left column — sticky — matches prototype .left ── */
.r2-left{position:sticky;top:24px}
@media(max-width:820px){.r2-left{position:static}}

/* ── Eyebrow + hero numbers — scaled for desktop two-column layout ── */
.r2-eyebrow{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#52525b;margin-bottom:6px}
.r2-hero-num{font-size:32px;font-weight:800;color:#10b981;letter-spacing:-0.02em;line-height:1.05;font-variant-numeric:tabular-nums}
.r2-hero-yr{font-size:20px;font-weight:800;color:#10b981;letter-spacing:-.01em}
.r2-hero-sub{font-size:13px;color:#a1a1aa;margin-top:5px;margin-bottom:20px;line-height:1.4}
.r2-hero-sub b{color:#fafafa;font-weight:600}

/* ── Card stack — height must clear the back card's full visual extent.
   Back card: translate(34px,64px) scale(.93) with transform-origin:50% 50%
   → visual bottom = (0.035×164 + 64) + 164×0.93 = 69.7 + 152.5 = 222.2px
   265px gives ~43px clearance so swaphint + footnote sit cleanly below. */
.r2-stack{position:relative;height:265px;margin-bottom:10px}

/* ── Solo single-card stack ── */
.r2-solo-stack{position:relative;height:180px;margin-bottom:12px}

/* ── Card: desktop-scaled 260×164px (prototype was 300×188 tuned for ~390px mobile) ── */
.r2-pcard{
  position:absolute;left:0;
  width:260px;height:164px;
  border-radius:18px;padding:20px;color:#fff;overflow:hidden;
  border:1px solid rgba(255,255,255,.09);
  transition:transform .38s cubic-bezier(.4,0,.2,1),box-shadow .38s;
}

/* Front card */
.r2-pcard-front{
  transform:translate(0,0) scale(1);
  z-index:5;
  box-shadow:0 14px 36px rgba(0,0,0,.55);
}

/* Back card — prototype offset kept; tappable strip = 34px right + bottom of 217px vs 164px front */
.r2-pcard-back{
  transform:translate(34px,64px) scale(.93);
  z-index:2;
  cursor:pointer;outline:none;
  transition:transform .38s cubic-bezier(.4,0,.2,1),opacity .18s;
}
.r2-pcard-back:hover{opacity:.88}
.r2-pcard-back:focus-visible{outline:2px solid rgba(255,255,255,.4);outline-offset:2px}

/* Solo card — same dimensions, front position */
.r2-pcard-solo{
  transform:translate(0,0) scale(1);
  z-index:5;
  box-shadow:0 14px 36px rgba(0,0,0,.55);
}

/* ── Card internals — scaled down to suit 260×164px card ── */
.r2-chip{width:30px;height:22px;border-radius:4px;
  background:linear-gradient(135deg,#D4A827,#A07D1A);margin-bottom:12px}
.r2-pc-name{font-size:16px;font-weight:700;line-height:1.2}
.r2-pc-cats{font-size:11px;opacity:.82;margin-top:4px;font-weight:500;line-height:1.4}
.r2-pc-net{position:absolute;bottom:16px;left:20px;font-size:11px;opacity:.9}
.r2-pc-net b{font-size:14px;font-weight:700}
.r2-pc-sheen{position:absolute;inset:0;
  background:linear-gradient(115deg,transparent 40%,rgba(255,255,255,.10) 50%,transparent 60%);
  pointer-events:none}

/* ── Swap hint — matches prototype .swaphint ── */
.r2-swaphint{font-size:12px;color:#52525b;margin-bottom:10px}
.r2-swaphint b{color:#a1a1aa;font-weight:600}

/* ── Combo footnote ── */
.r2-footnote{font-size:12.5px;color:#6b7280;line-height:1.55;margin-top:4px}
.r2-footnote b{color:#10b981;font-weight:700;font-variant-numeric:tabular-nums}

/* ── Single-card baseline — matches prototype .betterline ── */
.r2-betterline{margin-top:12px;font-size:15px;color:#a1a1aa;line-height:1.4}
.r2-betterline b{color:#10b981;font-size:22px;font-weight:800;letter-spacing:-0.01em;font-variant-numeric:tabular-nums}

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
