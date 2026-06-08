/**
 * ResultsScreenV2.tsx — Stage 1 + Stage 2 of the V2 results redesign.
 *
 * Two-column desktop layout (≥820px): left column (sticky) = hero number + card stack/single;
 * right column = 5-icon detail panel (pros/cons, hack, math, priorities, things to know).
 * Stacks to single column on mobile.
 *
 * Props are identical to ResultsScreen — drop-in swap when all stages are complete.
 * Preview via ?v2 query param (CardEngine gates it).
 *
 * Stage 2 additions: icon-circle row + wired detail panels for active card.
 * Deferred to Stage 3: math two-figure treatment, per-card combo priority coverage.
 */
import React, { useState } from 'react';
import { Scale, Zap, Calculator, Target, Info } from 'lucide-react';
import type { RankResult, RankedCard, CardMeta, Priorities, PriorityKey } from '../../lib/cardEngine/rankCards';
import type { MonthlySpend, CategoryEarn } from '../../lib/cardEngine/computeEarn';
import { evalPriorityForCard, LABEL, type AlternativeForPriority } from '../../lib/cardEngine/evaluatePriorities';
import { resolveTileColor } from './CardTile';
import { CardMathBreakdown } from './CardMathBreakdown';
import RecommendationCard, { type DevaluationFlag } from './RecommendationCard';
import type { SelectedHack, SurfacedInsight } from '../../lib/cardEngine/selectHacks';
import { LABEL as PRIORITY_LABEL } from '../../lib/cardEngine/evaluatePriorities';

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

/** Split executionSteps (newline-separated) into numbered step rows. */
const HackSteps: React.FC<{ steps: string }> = ({ steps }) => {
  const lines = steps.split(/\r?\n/).map(l => l.replace(/^\d+[\.\)]\s*/, '').trim()).filter(Boolean);
  if (lines.length === 0) return null;
  return (
    <div className="r2-steps">
      {lines.map((l, i) => (
        <div key={i} className="r2-step">
          <span className="r2-sn">{i + 1}</span>
          <span>{l}</span>
        </div>
      ))}
    </div>
  );
};

const CAT_ACCENT_R2: Record<string, string> = {
  Online: '#06b6d4', Travel: '#10b981', Dining: '#f59e0b', Fuel: '#8b5cf6',
  Grocery: '#10b981', Utility: '#8b5cf6', Subscriptions: '#06b6d4',
  International: '#10b981', 'Other(base)': '#71717a',
};

/** Per-category row for the combo Math panel — mirrors CardMathBreakdown's CategoryRow. */
const R2CategoryRow: React.FC<{
  cat: string; ce: CategoryEarn; monthlySpend: number; annual: number; maxAnnual: number;
}> = ({ cat, ce, monthlySpend, annual, maxAnnual }) => {
  const accent = CAT_ACCENT_R2[cat] ?? '#71717a';
  const pct = Math.max(2, (annual / maxAnnual) * 100);
  return (
    <div className="r2-cat-row">
      <div className="r2-cat-top">
        <span className="r2-cat-name">
          <i className="r2-cat-dot" style={{ background: accent }} />
          {cat === 'Other(base)' ? 'Everything else' : cat}
        </span>
        <span className="r2-cat-val">{inr(annual)}/yr</span>
      </div>
      <div className="r2-cat-spend">
        {inr(monthlySpend)}/mo
        {ce.baseRatePer100 > 0 && (
          <span className="r2-cat-rate"> · {ce.baseRatePer100.toFixed(2)}% back</span>
        )}
      </div>
      <div className="r2-bar-track">
        <div className="r2-bar" style={{ width: pct + '%', background: accent }} />
      </div>
      {ce.capHit && ce.capBinding != null && (
        <div className="r2-caphit">
          earned {inr(ce.rawBeforeCap * 12)}/yr → capped at {inr(ce.capBinding * 12)}/yr
          <span className="r2-caphit-loss">
            {inr((ce.rawBeforeCap - ce.guaranteed) * 12)}/yr lost to the cap
          </span>
        </div>
      )}
      {ce.thresholdAmount != null && ce.thresholdRatePer100 != null && monthlySpend > ce.thresholdAmount && (
        <div className="r2-thresh">
          spend above {inr(ce.thresholdAmount)}/mo earns the boosted {ce.thresholdRatePer100.toFixed(2)}% rate
        </div>
      )}
    </div>
  );
};

// ── Icon row configuration ───────────────────────────────────────────────────
const ICONS = [
  { key: 'pros',       label: 'Pros & cons',     Icon: Scale,      accent: '#10b981' },
  { key: 'hack',       label: 'Hack',             Icon: Zap,        accent: '#8b5cf6' },
  { key: 'math',       label: 'The math',         Icon: Calculator, accent: '#06b6d4' },
  { key: 'priorities', label: 'Priorities',       Icon: Target,     accent: '#f59e0b' },
  { key: 'know',       label: 'Things to know',   Icon: Info,       accent: '#f59e0b' },
] as const;
type IconKey = typeof ICONS[number]['key'];

export const ResultsScreenV2: React.FC<Props> = ({
  result, monthlySpend, baselineNet, hacks, intelligence, narratives,
  onKnowMore, priorities, altForTop, isTravelPriority, devaluations, onBack, onRestart,
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

  // Which detail panel is open (null = all closed).
  const [activeIcon, setActiveIcon] = useState<IconKey | null>('pros');
  const toggleIcon = (key: IconKey) => setActiveIcon(prev => prev === key ? null : key);

  // Alt-card expansion (single-card view only).
  const [altExpanded, setAltExpanded] = useState(false);

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

        {/* ── RIGHT: icon row + detail panels (Stage 2) ── */}
        <div className="r2-right">
          {/* Active card drives the panel — front card in combo, top card in single */}
          {(() => {
            const activeCard = comboHero && front ? front : top;
            if (!activeCard) return null;
            const cardId = activeCard.cardId;
            const hack = hacks?.[cardId] ?? null;
            const intel = intelligence?.[cardId] ?? [];
            const narrative = narratives?.[cardId];
            const activeIconCfg = ICONS.find(i => i.key === activeIcon);

            // Collect priority keys from the three tiers
            const priorityKeys: PriorityKey[] = [
              ...(priorities?.top ? [priorities.top] : []),
              ...(priorities?.secondary ? [priorities.secondary] : []),
              ...(priorities?.niceToHave ? [priorities.niceToHave] : []),
            ];

            // Category label for active card
            const cardCats = comboHero && combo
              ? (combo.assignments[cardId] ?? []).join(' · ')
              : Object.entries(activeCard.earn.perCategory)
                  .filter(([, v]) => v.guaranteed > 0)
                  .sort(([, a], [, b]) => b.guaranteed - a.guaranteed)
                  .slice(0, 3)
                  .map(([c]) => c)
                  .join(' · ');

            return (
              <>
                {/* ── Icon row ── */}
                <div className="r2-iconrow">
                  {ICONS.map(({ key, label, Icon, accent }) => (
                    <button
                      key={key}
                      className={'r2-iconcircle' + (activeIcon === key ? ' on' : '')}
                      style={{ '--r2-accent': accent } as React.CSSProperties}
                      onClick={() => toggleIcon(key)}
                      aria-label={label}
                      aria-pressed={activeIcon === key}
                    >
                      <div className="r2-circ">
                        <Icon size={20} strokeWidth={1.75} />
                      </div>
                      <span className="r2-lbl">{label}</span>
                    </button>
                  ))}
                </div>

                {/* ── Detail panel ── */}
                {activeIcon && activeIconCfg && (
                  <div className="r2-detail" style={{ '--r2-accent': activeIconCfg.accent } as React.CSSProperties}>
                    {/* Card context header */}
                    <div className="r2-detail-which">
                      {activeCard.meta.name}{cardCats ? ` · ${cardCats}` : ''}
                    </div>

                    {/* ── Pros & cons ── */}
                    {activeIcon === 'pros' && (
                      <div className="r2-panel-pros">
                        {narrative ? (
                          <>
                            {narrative.topPros.length > 0 && (
                              <div className="r2-procon-group">
                                {narrative.topPros.map((p, i) => (
                                  <div key={i} className="r2-item">
                                    <span className="r2-pl">+</span>
                                    <span>{p.text}{p.valuePerYear > 0 ? <span className="r2-item-val"> · {inr(p.valuePerYear)}/yr</span> : null}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {narrative.topCons.length > 0 && (
                              <div className="r2-procon-group" style={{ marginTop: narrative.topPros.length > 0 ? '10px' : 0 }}>
                                {narrative.topCons.map((c, i) => (
                                  <div key={i} className="r2-item">
                                    <span className="r2-mn">−</span>
                                    <span>{c.text}{c.valuePerYear > 0 ? <span className="r2-item-val"> · {inr(c.valuePerYear)}/yr</span> : null}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {onKnowMore && (
                              <button className="r2-linkbtn" onClick={() => onKnowMore(cardId)}>
                                See full pros &amp; cons →
                              </button>
                            )}
                          </>
                        ) : (
                          <div className="r2-empty">No pros/cons data available.</div>
                        )}
                      </div>
                    )}

                    {/* ── Hack ── */}
                    {activeIcon === 'hack' && (
                      <div className="r2-panel-hack">
                        {hack ? (
                          hack.locked ? (
                            <div className="r2-hackbox locked">
                              <div className="r2-ht">{hack.name}</div>
                              <div className="r2-hd">
                                Unlocks at <b>₹{hack.locked.minMonthlySpend.toLocaleString('en-IN')}/month</b> total spend.
                                You&rsquo;re <b>₹{hack.locked.gap.toLocaleString('en-IN')}/month</b> away.
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="r2-hackbox">
                                <div className="r2-ht">{hack.name}</div>
                                <div className="r2-hd">{hack.whyItMatters}</div>
                              </div>
                              {hack.executionSteps && (
                                <HackSteps steps={hack.executionSteps} />
                              )}
                              {hack.difficulty && (
                                <div className="r2-hack-meta">
                                  Difficulty: <b>{hack.difficulty}</b>
                                  {hack.commonFailure && <> · Watch out: {hack.commonFailure}</>}
                                </div>
                              )}
                            </>
                          )
                        ) : (
                          <div className="r2-empty">No hack available for this card yet.</div>
                        )}
                      </div>
                    )}

                    {/* ── The math ── */}
                    {activeIcon === 'math' && (
                      <div className="r2-panel-math">
                        {comboHero && combo ? (() => {
                          // Combo: show only THIS card's assigned categories in the total.
                          // Unassigned categories (where user spends but the other card handles them)
                          // are shown greyed with attribution — excluded from this card's total.
                          const assignedCats = new Set(combo.assignments[activeCard.cardId] ?? []);
                          type SpCat = keyof typeof monthlySpend;
                          const spendCats = (Object.keys(monthlySpend) as SpCat[])
                            .filter(cat => (monthlySpend[cat] ?? 0) > 0);
                          const assignedRows = spendCats
                            .filter(cat => assignedCats.has(cat))
                            .map(cat => ({
                              cat,
                              ce: activeCard.earn.perCategory[cat],
                              spend: monthlySpend[cat as keyof typeof monthlySpend] ?? 0,
                              annual: (activeCard.earn.perCategory[cat]?.guaranteed ?? 0) * 12,
                            }))
                            .filter(r => r.ce != null)
                            .sort((a, b) => b.annual - a.annual);
                          const excludedRows = spendCats
                            .filter(cat => !assignedCats.has(cat));
                          const cardNet = cardContrib(activeCard); // assigned earn gross — matches card display
                          const maxAnnual = Math.max(1, ...assignedRows.map(r => r.annual));

                          return (
                            <>
                              <div className="r2-math-hero">
                                <span className="r2-math-hero-lbl">Your value from this card</span>
                                <span className="r2-math-hero-val">
                                  {inr(cardNet)}<span className="r2-math-hero-yr">/yr</span>
                                </span>
                              </div>
                              <div className="r2-math-rows">
                                {assignedRows.map(({ cat, ce, spend, annual }) => (
                                  <R2CategoryRow
                                    key={cat}
                                    cat={cat}
                                    ce={ce}
                                    monthlySpend={spend}
                                    annual={annual}
                                    maxAnnual={maxAnnual}
                                  />
                                ))}
                                {excludedRows.map(cat => (
                                  <div key={cat} className="r2-math-row excluded">
                                    <span className="r2-math-row-cat">
                                      {cat}
                                      <span className="r2-math-attributed"> → your other card</span>
                                    </span>
                                    <span className="r2-math-row-val excluded">—</span>
                                  </div>
                                ))}
                              </div>
                              <div className="r2-math-total">
                                <span>Value from assigned categories</span>
                                <span className="r2-math-total-val">{inr(cardNet)}</span>
                              </div>
                              {activeCard.annualUpside > 0 && (
                                <div className="r2-math-upside">
                                  + up to {inr(activeCard.annualUpside)}/yr extra via the card&rsquo;s
                                  portal/app&nbsp;<span className="r2-math-upside-tag">conditional</span>
                                </div>
                              )}
                            </>
                          );
                        })() : (
                          // Single-card: all categories belong to this card — CardMathBreakdown
                          // nets to netGuaranteedPerYear which matches the card's "net for you" display.
                          <>
                            <div className="r2-math-hero">
                              <span className="r2-math-hero-lbl">Your value</span>
                              <span className="r2-math-hero-val">
                                {inr(activeCard.netGuaranteedPerYear)}<span className="r2-math-hero-yr">/yr</span>
                              </span>
                            </div>
                            <CardMathBreakdown
                              earn={activeCard.earn}
                              effectiveAnnualFee={activeCard.effectiveAnnualFee}
                              annualFee={(activeCard.meta as CardMeta).annualFee ?? 0}
                              feeWaiverSpend={(activeCard.meta as CardMeta).feeWaiverSpend ?? 0}
                              netGuaranteedPerYear={activeCard.netGuaranteedPerYear}
                              annualUpside={activeCard.annualUpside}
                              monthlySpend={monthlySpend}
                            />
                          </>
                        )}
                      </div>
                    )}

                    {/* ── Priorities ── */}
                    {activeIcon === 'priorities' && (
                      <div className="r2-panel-priorities">
                        {/* In combo: clarify which card's coverage is shown */}
                        {comboHero && (
                          <div className="r2-pri-context">
                            Showing <b>{activeCard.meta.name}</b>&rsquo;s coverage — swap cards to compare
                          </div>
                        )}
                        {priorityKeys.length === 0 ? (
                          <div className="r2-empty">You didn&rsquo;t set any priorities.</div>
                        ) : (
                          priorityKeys.map(key => {
                            const ev = evalPriorityForCard(key, activeCard, monthlySpend);
                            return (
                              <div key={key} className={'r2-pri-row ' + ev.status}>
                                <span className="r2-pri-glyph">
                                  {ev.status === 'met' ? '✓' : ev.status === 'partial' ? '⚠' : '✗'}
                                </span>
                                <div>
                                  <div className="r2-pri-label">{LABEL[key]}</div>
                                  {ev.line && <div className="r2-pri-line">{ev.line}</div>}
                                </div>
                              </div>
                            );
                          })
                        )}
                        {/* Alt for missed top priority — inside the Priorities panel */}
                        {!comboHero && altForTop && (
                          <div className="r2-alt-card">
                            <div className="r2-alt-pill">Alternative for your {PRIORITY_LABEL[altForTop.key]} priority</div>
                            <div className="r2-alt-line">
                              Your optimal setup earns <b>{inr(altForTop.optimalNet)}</b>. The closest setup that
                              covers <b>{PRIORITY_LABEL[altForTop.key]}</b> is <b>{altForTop.card.meta.name}</b>,
                              earning {inr(altForTop.altNet)} — that&rsquo;s <b>{inr(altForTop.costOfSwitch)} less</b>.
                              Your call.
                            </div>
                            <button className="r2-alt-toggle" onClick={() => setAltExpanded(v => !v)}>
                              {altExpanded ? 'Hide details ↑' : 'See full details →'}
                            </button>
                            {altExpanded && (
                              <div className="r2-alt-detail">
                                <RecommendationCard
                                  card={altForTop.card}
                                  monthlySpend={monthlySpend}
                                  forexPct={(altForTop.card.meta as CardMeta).forexPct}
                                  isTravelPriority={isTravelPriority}
                                  devaluation={devaluations?.[altForTop.card.cardId]}
                                  hack={hacks?.[altForTop.card.cardId] ?? undefined}
                                  intelligence={intelligence?.[altForTop.card.cardId]}
                                  narrative={narratives?.[altForTop.card.cardId]}
                                  onKnowMore={onKnowMore ? () => onKnowMore(altForTop.card.cardId) : undefined}
                                />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* ── Things to know ── */}
                    {activeIcon === 'know' && (
                      <div className="r2-panel-know">
                        {intel.length === 0 ? (
                          <div className="r2-empty">No current alerts or notable changes for this card.</div>
                        ) : (
                          intel.map((item, i) => (
                            <div key={i} className={'r2-item know ' + (item.severity ?? '')}>
                              <span className="r2-know-dot" />
                              <span>{item.text}</span>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
              </>
            );
          })()}

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

/* ── Solo single-card stack — height = card height (164px) + 40px clearance so
   the betterline sits cleanly below the card's bottom edge. */
.r2-solo-stack{position:relative;height:204px;margin-bottom:12px}

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

/* ── Icon row ── */
.r2-iconrow{display:flex;gap:8px;margin-bottom:14px}
.r2-iconcircle{
  flex:1;display:flex;flex-direction:column;align-items:center;gap:7px;
  cursor:pointer;background:none;border:none;font-family:inherit;padding:0}
.r2-circ{
  width:48px;height:48px;border-radius:50%;
  background:#0c0c0e;border:1px solid #27272a;
  display:flex;align-items:center;justify-content:center;
  color:#71717a;transition:all .18s}
.r2-iconcircle.on .r2-circ{
  border-color:var(--r2-accent,#10b981);
  background-color:color-mix(in srgb,var(--r2-accent,#10b981) 10%,#0c0c0e);
  box-shadow:0 0 0 1px color-mix(in srgb,var(--r2-accent,#10b981) 30%,transparent),
             0 0 14px color-mix(in srgb,var(--r2-accent,#10b981) 18%,transparent);
  color:var(--r2-accent,#10b981)}
.r2-iconcircle:hover:not(.on) .r2-circ{border-color:#3f3f46;color:#a1a1aa}
.r2-lbl{font-size:10px;font-weight:600;color:#52525b;text-align:center;line-height:1.3}
.r2-iconcircle.on .r2-lbl{color:#d4d4d8}

/* ── Detail panel ── */
.r2-detail{
  background:#0c0c0e;border:1px solid #1f1f23;border-radius:14px;
  padding:18px;margin-bottom:8px;
  border-top-color:color-mix(in srgb,var(--r2-accent,#10b981) 35%,#1f1f23)}
.r2-detail-which{
  font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
  color:#52525b;margin-bottom:14px}

/* ── Shared item rows ── */
.r2-item{display:flex;gap:9px;font-size:13px;color:#d4d4d8;line-height:1.55;margin-bottom:8px}
.r2-pl{color:#10b981;font-weight:800;flex-shrink:0}
.r2-mn{color:#f59e0b;font-weight:800;flex-shrink:0}
.r2-item-val{color:#71717a;font-size:12px}
.r2-empty{font-size:13px;color:#52525b;line-height:1.5}

/* ── Link button ── */
.r2-linkbtn{
  background:none;border:none;color:#8b5cf6;font-family:inherit;font-size:13px;
  font-weight:600;cursor:pointer;padding:8px 0 0;display:block}
.r2-linkbtn:hover{color:#a78bfa}

/* ── Hack panel ── */
.r2-hackbox{
  background:#140d1f;border:1px solid #8b5cf633;border-radius:10px;
  padding:13px;margin-bottom:10px}
.r2-hackbox.locked{background:#111113;border-color:#27272a}
.r2-ht{color:#8b5cf6;font-weight:700;font-size:13.5px;margin-bottom:5px}
.r2-hd{color:#a1a1aa;font-size:13px;line-height:1.55}
.r2-hackbox.locked .r2-ht{color:#52525b}
.r2-steps{margin-top:10px}
.r2-step{display:flex;gap:10px;font-size:13px;color:#d4d4d8;line-height:1.5;margin-bottom:9px}
.r2-sn{
  width:20px;height:20px;border-radius:50%;background:#18181b;color:#8b5cf6;
  font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.r2-hack-meta{font-size:11.5px;color:#52525b;margin-top:4px;line-height:1.5}
.r2-hack-meta b{color:#71717a}

/* ── Math panel hero stat ── */
.r2-math-hero{
  display:flex;align-items:baseline;justify-content:space-between;
  margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid #1f1f23}
.r2-math-hero-lbl{font-size:12px;font-weight:600;color:#a1a1aa}
.r2-math-hero-val{font-size:26px;font-weight:800;color:#10b981;
  letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.r2-math-hero-yr{font-size:15px;font-weight:700;color:#10b981}

/* ── Combo Math breakdown rows — mirrors CardMathBreakdown's CategoryRow ── */
.r2-math-rows{display:flex;flex-direction:column;gap:13px;margin-bottom:0}
/* Rich per-category rows (assigned) */
.r2-cat-row{font-family:'DM Sans',system-ui,sans-serif}
.r2-cat-top{display:flex;justify-content:space-between;align-items:baseline}
.r2-cat-name{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600;color:#fafafa}
.r2-cat-dot{width:8px;height:8px;border-radius:50%;display:inline-block;flex-shrink:0}
.r2-cat-val{font-size:14px;font-weight:700;color:#fafafa;font-variant-numeric:tabular-nums}
.r2-cat-spend{font-size:11.5px;color:#71717a;margin:3px 0 5px 16px}
.r2-cat-rate{color:#a1a1aa}
.r2-bar-track{height:5px;background:#18181b;border-radius:3px;overflow:hidden;margin-left:16px}
.r2-bar{height:100%;border-radius:3px}
.r2-caphit{font-size:11px;color:#f59e0b;margin:5px 0 0 16px;display:flex;flex-wrap:wrap;gap:8px}
.r2-caphit-loss{color:#dc2626;font-weight:600}
.r2-thresh{font-size:11px;color:#10b981;margin:4px 0 0 16px}
/* Excluded (other card's) rows — simple, greyed */
.r2-math-row{
  display:flex;justify-content:space-between;align-items:baseline;
  font-size:13px;padding:7px 0;border-bottom:1px solid #141416}
.r2-math-row.excluded .r2-math-row-cat{color:#3f3f46}
.r2-math-row-val.excluded{color:#3f3f46}
.r2-math-attributed{font-size:11px;color:#3f3f46;font-style:italic}
/* Total line */
.r2-math-total{
  display:flex;justify-content:space-between;align-items:baseline;
  padding:10px 0 0;margin-top:8px;border-top:1px solid #27272a}
.r2-math-total>span:first-child{font-size:13px;font-weight:600;color:#a1a1aa}
.r2-math-total-val{font-size:20px;font-weight:800;color:#10b981;
  font-variant-numeric:tabular-nums;letter-spacing:-.02em}
/* Upside note (combo) */
.r2-math-upside{
  margin-top:10px;font-size:12px;color:#a1a1aa;line-height:1.5;
  background:#18140a;border:1px solid #3a2f10;border-radius:9px;padding:9px 11px}
.r2-math-upside-tag{
  display:inline-block;font-size:9px;font-weight:700;text-transform:uppercase;
  color:#f59e0b;border:1px solid #f59e0b;border-radius:4px;
  padding:1px 5px;margin-left:5px;letter-spacing:.05em;vertical-align:middle}

/* ── Priorities panel context note (combo) ── */
.r2-pri-context{
  font-size:12px;color:#52525b;margin-bottom:12px;line-height:1.4}
.r2-pri-context b{color:#71717a}

/* ── Priorities panel ── */
.r2-pri-row{display:flex;gap:10px;font-size:13px;padding:8px 0;
  border-bottom:1px solid #141416;align-items:flex-start}
.r2-pri-row:last-child{border-bottom:none}
.r2-pri-glyph{font-size:14px;font-weight:800;width:18px;flex-shrink:0;margin-top:1px}
.r2-pri-row.met .r2-pri-glyph{color:#10b981}
.r2-pri-row.partial .r2-pri-glyph{color:#f59e0b}
.r2-pri-row.unmet .r2-pri-glyph{color:#52525b}
.r2-pri-label{color:#fafafa;font-weight:600;font-size:13px}
.r2-pri-line{color:#a1a1aa;font-size:12.5px;margin-top:2px;line-height:1.45}

/* ── Things to know panel ── */
.r2-item.know{align-items:flex-start}
.r2-know-dot{
  width:7px;height:7px;border-radius:50%;background:#3f3f46;
  flex-shrink:0;margin-top:5px}
.r2-item.know.high .r2-know-dot{background:#f59e0b}
.r2-item.know.critical .r2-know-dot{background:#ef4444}

/* ── Alt card — single-card path, purple-bordered, desktop-sized ── */
.r2-alt-card{
  background:#0c0c0e;border:1px solid #8b5cf633;border-radius:12px;
  padding:16px;margin-top:16px}
.r2-alt-pill{
  display:inline-block;background:#18181b;color:#8b5cf6;
  font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;
  padding:3px 9px;border-radius:6px;margin-bottom:10px}
.r2-alt-line{
  font-size:13.5px;color:#d4d4d8;line-height:1.55;margin-bottom:10px}
.r2-alt-line b{color:#fafafa}
.r2-alt-toggle{
  background:none;border:none;color:#8b5cf6;font-family:inherit;
  font-size:13px;font-weight:600;cursor:pointer;padding:4px 0;display:block}
.r2-alt-toggle:hover{color:#a78bfa}
.r2-alt-detail{margin-top:14px;border-top:1px solid #1f1f23;padding-top:14px}

/* ── Nav ── */
.r2-nav{display:flex;gap:8px;margin-top:32px}
.r2-back{flex:1;background:#1c1c20;border:1px solid #3f3f46;color:#fafafa;
  font-family:inherit;font-size:13px;font-weight:700;padding:11px;border-radius:10px;cursor:pointer}
.r2-restart{flex:1;background:#141417;border:1px solid #2a2a30;color:#a1a1aa;
  font-family:inherit;font-size:13px;font-weight:600;padding:11px;border-radius:10px;cursor:pointer}
`;

export default ResultsScreenV2;
