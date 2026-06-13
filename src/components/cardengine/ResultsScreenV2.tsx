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
import { Scale, Zap, Calculator, Target, Info, Plane } from 'lucide-react';
import AprEmiCalculator from './AprEmiCalculator';
import type { TransferHack, TransferPartner } from '../../lib/cardEngine/loadCardDB';
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
  transferHacks?: Record<string, TransferHack>;
  transferPartners?: Record<string, TransferPartner[]>;
  onBack?: () => void;
  onRestart?: () => void;
}

/** A single gradient card matching the prototype .pcard composition exactly. */
const PCard: React.FC<{
  card: { meta: { name: string; bank?: string } };
  cats: string;
  net: number;
  hideNet?: boolean;
  verdictBadge?: string;
  verdictLine?: string;
  className?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  role?: string;
  tabIndex?: number;
  'aria-label'?: string;
}> = ({ card, cats, net, hideNet, verdictBadge, verdictLine, className = '', style, onClick, onKeyDown, role, tabIndex, 'aria-label': ariaLabel }) => {
  const { from, to } = resolveTileColor(card.meta.name, card.meta.bank ?? '');
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
      {verdictBadge ? (
        <div className="r2-pc-verdict">
          <span className={'r2-pc-vbadge r2-vpc-' + verdictBadge.replace(' ', '_')}>{verdictBadge}</span>
          {verdictLine && <span className="r2-pc-vline">{verdictLine}</span>}
        </div>
      ) : (
        <div className="r2-pc-cats">{cats}</div>
      )}
      {!hideNet && <div className="r2-pc-net">net for you <b>{inr(net)}/yr</b></div>}
      <div className="r2-pc-num">4291 •••• •••• 7634</div>
      <div className="r2-pc-holder">P. Mehta</div>
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

// ── Transfer callout box ─────────────────────────────────────────────────────
const XFR_STEPS = [
  'Find the seat first — confirm an award seat exists on your dates before transferring. No seat, don\'t transfer.',
  'Check the math — note the award price, work back through the card\'s ratio for points needed.',
  'Transfer the points — move only what you need plus a small buffer; transfers aren\'t always instant.',
  'Book immediately — award space can vanish; lock the seat the same session.',
  'Pay taxes & fees — awards still carry taxes and sometimes surcharges; check before transferring.',
];

const TransferCallout: React.FC<{
  hack: TransferHack;
  partners: TransferPartner[];
  cardName: string;
}> = ({ hack, partners, cardName }) => {
  const [bodyOpen, setBodyOpen] = useState(false);
  const [stepsOpen, setStepsOpen] = useState(false);
  return (
    <div className="r2-xfr-box">
      <button className="r2-xfr-head" onClick={() => setBodyOpen(v => !v)}>
        <Plane size={15} strokeWidth={2} className="r2-xfr-icon" />
        <span>Turn points into flights &amp; hotels</span>
        <span className={'r2-xfr-chev' + (bodyOpen ? ' open' : '')}>›</span>
      </button>
      {bodyOpen && (
        <div className="r2-xfr-body">
          <p className="r2-xfr-desc">
            {cardName} lets you move reward points to airline or hotel programmes, where the same points can be worth far more — especially for business-class flights and hotel stays.
          </p>
          <div className="r2-xfr-rows">
            {hack.flightHack && (
              <div className="r2-xfr-row">
                <span className="r2-xfr-pill flight">Flights</span>
                <span className="r2-xfr-text">{hack.flightHack}</span>
              </div>
            )}
            {hack.hotelHack && (
              <div className="r2-xfr-row">
                <span className="r2-xfr-pill hotel">Hotels</span>
                <span className="r2-xfr-text">{hack.hotelHack}</span>
              </div>
            )}
          </div>
          {partners.length > 0 && (
            <div className="r2-xfr-partners">
              {partners.map((p, i) => (
                <span key={i} className={'r2-xfr-partner ' + p.type}>
                  {p.partner} <span className="r2-xfr-ratio">{p.ratio}</span>
                </span>
              ))}
            </div>
          )}
          <button className="r2-xfr-seehow" onClick={() => setStepsOpen(v => !v)}>
            {stepsOpen ? 'Hide steps ↑' : 'See how → 5 steps to book'}
          </button>
          {stepsOpen && (
            <div className="r2-steps r2-xfr-steps">
              {XFR_STEPS.map((s, i) => (
                <div key={i} className="r2-step">
                  <span className="r2-sn xfr">{i + 1}</span>
                  <span>{s}</span>
                </div>
              ))}
            </div>
          )}
          <div className="r2-xfr-foot">
            Best-case sweet-spots &middot; confirm award live before transferring &middot; as of {hack.transferAsOf}
          </div>
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
  onKnowMore, priorities, altForTop, isTravelPriority, devaluations,
  transferHacks, transferPartners, liquidity, onBack, onRestart,
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

  // Which owned card is in the foreground (Journey A carousel).
  const [ownedFrontIdx, setOwnedFrontIdx] = useState(0);

  // Clarity tooltip open state (Journey A hero).
  const [clarityOpen, setClarityOpen] = useState(false);

  // Which owned card is selected in the balance calculator dropdown.
  const [balanceCardIdx, setBalanceCardIdx] = useState(0);

  // Which detail panel is open (null = all closed).
  const [activeIcon, setActiveIcon] = useState<IconKey | null>('pros');
  const toggleIcon = (key: IconKey) => setActiveIcon(prev => prev === key ? null : key);

  // Hack steps expansion (collapses when icon panel switches card).
  const [hackStepsOpen, setHackStepsOpen] = useState(false);

  // Alt-card expansion (single-card view only).
  const [altExpanded, setAltExpanded] = useState(false);

  // Lower horizontal tabs (none open initially).
  type TabKey = 'fee' | 'others' | 'how';
  const [activeTab, setActiveTab] = useState<TabKey | null>(null);
  const toggleTab = (key: TabKey) => setActiveTab(prev => prev === key ? null : key);

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
        <div className={'r2-left' + (journeyA ? ' r2-left--a' : '')}>
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
              {combo.combinedFees > 0 ? (
                <div className="r2-combo-feenote">after {inr(combo.combinedFees)} in annual fees</div>
              ) : (
                <div className="r2-combo-feenote waived">both annual fees waived</div>
              )}

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
              {/* ── Journey A: owned-card carousel, then divider, then recommendation ── */}
              {journeyA && result.ownedVerdicts && result.ownedVerdicts.length > 0 && (() => {
                const verdicts = result.ownedVerdicts!;
                const N = verdicts.length;
                const fi = ownedFrontIdx % N;
                const activeV = verdicts[fi];
                const toStub = (v: typeof activeV) => ({ meta: { name: v.cardName, bank: v.bank } });
                const prev = () => setOwnedFrontIdx(i => (i - 1 + N) % N);
                const next = () => setOwnedFrontIdx(i => (i + 1) % N);

                return (
                  <>
                    <div className="r2-eyebrow">Your cards</div>
                    {N === 1 ? (
                      <div className="r2-solo-stack">
                        <PCard
                          card={toStub(activeV)}
                          cats=""
                          net={activeV.netPerYear}
                          hideNet
                          verdictBadge={activeV.verdict.replace('_', ' ')}
                          verdictLine={activeV.reason}
                          className="r2-pcard-solo"
                        />
                      </div>
                    ) : (
                      <div className="r2-owned-carousel">
                        <button
                          className="r2-carousel-arrow"
                          onClick={prev}
                          aria-label="Previous card"
                        >‹</button>
                        <div className="r2-carousel-body">
                          <div className="r2-solo-stack">
                            <PCard
                              card={toStub(activeV)}
                              cats=""
                              net={activeV.netPerYear}
                              hideNet
                              verdictBadge={activeV.verdict.replace('_', ' ')}
                              verdictLine={activeV.reason}
                              className="r2-pcard-solo"
                            />
                          </div>
                          <div className="r2-carousel-dots">
                            {verdicts.map((_, i) => (
                              <button
                                key={i}
                                className={'r2-carousel-dot' + (i === fi ? ' on' : '')}
                                onClick={() => setOwnedFrontIdx(i)}
                                aria-label={`Go to card ${i + 1}`}
                              />
                            ))}
                          </div>
                        </div>
                        <button
                          className="r2-carousel-arrow"
                          onClick={next}
                          aria-label="Next card"
                        >›</button>
                      </div>
                    )}
                    <hr className="r2-owned-divider" />
                  </>
                );
              })()}

              {/* Recommendation (both journeys; label differs) */}
              <div className="r2-eyebrow">
                {journeyA ? 'Top addition for your setup' : 'Your #1 fit'}
              </div>
              {journeyA && top.marginalGainPerYear != null ? (
                <>
                  <div className="r2-hero-row">
                    <div className="r2-hero-num">
                      +{inr(top.marginalGainPerYear)}<span className="r2-hero-yr">/yr</span>
                    </div>
                    <button
                      className={'r2-clarity-btn' + (clarityOpen ? ' on' : '')}
                      onClick={() => setClarityOpen(v => !v)}
                      aria-label="What does this mean?"
                      aria-expanded={clarityOpen}
                    >ⓘ</button>
                  </div>
                  <div className="r2-hero-sub">
                    new value over your current setup · <b>{top.meta.name}</b>
                  </div>
                  {clarityOpen && (
                    <div className="r2-clarity-popover">
                      {top.meta.name} is worth ~{inr(top.netGuaranteedPerYear)}/yr on its own — about {inr(top.marginalGainPerYear)} of that is new value on top of your current cards (the rest overlaps with what you already earn).
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="r2-hero-num">
                    {inr(top.netGuaranteedPerYear)}<span className="r2-hero-yr">/yr</span>
                  </div>
                  <div className="r2-hero-sub">
                    annual net benefit · <b>{top.meta.name}</b>
                  </div>
                </>
              )}

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
                  hideNet
                  className="r2-pcard-solo"
                />
              </div>

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
                                    <span>{p.text}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {narrative.topCons.length > 0 && (
                              <div className="r2-procon-group" style={{ marginTop: narrative.topPros.length > 0 ? '10px' : 0 }}>
                                {narrative.topCons.map((c, i) => (
                                  <div key={i} className="r2-item">
                                    <span className="r2-mn">−</span>
                                    <span>{c.text}</span>
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
                                <>
                                  <button
                                    className="r2-hack-seehow"
                                    onClick={() => setHackStepsOpen(v => !v)}
                                  >
                                    {hackStepsOpen ? 'Hide steps ↑' : 'See how →'}
                                  </button>
                                  {hackStepsOpen && <HackSteps steps={hack.executionSteps} />}
                                </>
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
                              {/* Fee + net — mirrors CardMathBreakdown's fee line */}
                              {(() => {
                                const fee = activeCard.effectiveAnnualFee;
                                const rawFee = (activeCard.meta as CardMeta).annualFee ?? 0;
                                const waiverSpend = (activeCard.meta as CardMeta).feeWaiverSpend ?? 0;
                                return (
                                  <>
                                    <div className="r2-math-feeline">
                                      <div className="r2-math-fee-label">
                                        {fee === 0 && rawFee > 0 ? (
                                          <>
                                            <span className="r2-math-fee-strike">{inr(rawFee)}</span>
                                            <span className="r2-math-fee-waived">waived (exceed {inr(waiverSpend)} routed spend)</span>
                                          </>
                                        ) : fee === 0 ? (
                                          <span className="r2-math-fee-waived">Lifetime Free — no annual fee</span>
                                        ) : (
                                          <span>Annual fee</span>
                                        )}
                                      </div>
                                      <span className="r2-math-fee-val">{fee === 0 ? '−₹0' : '−' + inr(fee)}</span>
                                    </div>
                                    <div className="r2-math-cardnet">
                                      <span>Net from this card</span>
                                      <span className="r2-math-cardnet-val">{inr(cardNet - fee)}</span>
                                    </div>
                                  </>
                                );
                              })()}
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

          {/* ── Stage 7: Transfer callout — visible without opening any icon panel ── */}
          {(() => {
            const activeCard = comboHero && front ? front : top;
            if (!activeCard) return null;
            const th = transferHacks?.[activeCard.cardId];
            if (!th || !th.displayTravelHack) return null;
            const partners = transferPartners?.[activeCard.cardId] ?? [];
            return <TransferCallout hack={th} partners={partners} cardName={activeCard.meta.name} />;
          })()}

          {/* ── Stage 4: Lower horizontal tabs ── */}
          {(() => {
            const t = result.transparency;
            const eligibleCount = t.totalEvaluated - t.failedIncome - t.failedFee;
            const premium = result.premiumWorthConsidering ?? [];
            const runners = result.runnersUp ?? [];

            const TAB_LABELS: Record<TabKey, string> = {
              fee:    'Other cards outside your fee preference',
              others: 'Also considered',
              how:    'How we picked',
            };

            return (
              <>
                <div className="r2-lowtabrow">
                  {(['fee', 'others', 'how'] as TabKey[]).map((key) => (
                    <button
                      key={key}
                      className={'r2-lowtabbtn' + (activeTab === key ? ' on' : '')}
                      onClick={() => toggleTab(key)}
                    >
                      {TAB_LABELS[key]}
                    </button>
                  ))}
                </div>

                {activeTab && (
                  <div className="r2-lowcontent">

                    {/* ── Other cards outside your fee preference ── */}
                    {activeTab === 'fee' && (
                      premium.length === 0 ? (
                        <div className="r2-lc-note">
                          No cards above your fee preference have significantly stronger value for your spend.
                          {result.premiumWorthConsidering === undefined
                            ? ' (This section is most relevant when you have a Travel or Lounge priority.)'
                            : ''}
                        </div>
                      ) : (
                        <>
                          {premium.map(c => (
                            <div key={c.cardId} className="r2-lc-item">
                              <span className="r2-lc-name">{c.meta.name}</span>
                              <span className="r2-lc-val">
                                {(c.meta as CardMeta).annualFee
                                  ? `₹${(c.meta as CardMeta).annualFee!.toLocaleString('en-IN')} fee`
                                  : 'Lifetime Free'}
                              </span>
                            </div>
                          ))}
                          <div className="r2-lc-note">Above your fee comfort, but strong value if you&rsquo;d stretch.</div>
                        </>
                      )
                    )}

                    {/* ── Others (runners-up) ── */}
                    {activeTab === 'others' && (
                      runners.length === 0 ? (
                        <div className="r2-lc-note">No other cards to show.</div>
                      ) : (
                        runners.map(c => (
                          <div key={c.cardId} className="r2-lc-item">
                            <span className="r2-lc-name">
                              {c.meta.name}
                              {c.inviteOnly && <span className="r2-lc-badge">invite</span>}
                            </span>
                            <span className="r2-lc-val">
                              {journeyA
                                ? `+${inr(c.marginalGainPerYear ?? 0)}/yr additional`
                                : `${inr(c.netGuaranteedPerYear)}/yr`}
                            </span>
                          </div>
                        ))
                      )
                    )}

                    {/* ── How we picked ── */}
                    {activeTab === 'how' && (
                      <>
                        <div className={'r2-elig yes'}>
                          <span className="r2-elig-n">✓{eligibleCount}</span>
                          <span className="r2-elig-t">eligible for you</span>
                        </div>
                        {t.failedIncome > 0 && (
                          <div className="r2-elig no">
                            <span className="r2-elig-n">✕{t.failedIncome}</span>
                            <span className="r2-elig-t">income mismatch</span>
                          </div>
                        )}
                        {t.failedFee > 0 && (
                          <div className="r2-elig no">
                            <span className="r2-elig-n">✕{t.failedFee}</span>
                            <span className="r2-elig-t">above your fee comfort</span>
                          </div>
                        )}
                        {t.inviteOnly > 0 && (
                          <div className="r2-elig no">
                            <span className="r2-elig-n">✕{t.inviteOnly}</span>
                            <span className="r2-elig-t">invite-only</span>
                          </div>
                        )}
                        {t.weakSpendMatch > 0 && (
                          <div className="r2-elig no">
                            <span className="r2-elig-n">✕{t.weakSpendMatch}</span>
                            <span className="r2-elig-t">weak fit for your spend</span>
                          </div>
                        )}
                        <div className="r2-lc-note" style={{ marginTop: 14 }}>
                          Ranked by net annual rupee value for your exact spends.
                          No card pays to rank here.
                        </div>
                      </>
                    )}

                  </div>
                )}
              </>
            );
          })()}
          {/* ── Credit note (low credit score warning — both journeys) ── */}
          {result.creditNote && (
            <div className="r2-creditnote">{result.creditNote}</div>
          )}
          {/* ── Balance calculator — Journey A only, above nav buttons ── */}
          {journeyA && result.ownedVerdicts && result.ownedVerdicts.length > 0 && (() => {
            const ownedVerdicts = result.ownedVerdicts!;
            const safeIdx = balanceCardIdx % ownedVerdicts.length;
            const balCard = ownedVerdicts[safeIdx];
            const balLiq = liquidity?.get(balCard.cardId);
            return (
              <details className="r2-fold">
                <summary>Thinking of carrying a balance? See what it costs</summary>
                <div className="r2-fold-body">
                  {ownedVerdicts.length > 1 && (
                    <div className="r2-fold-cardpick">
                      <label className="r2-fold-cardlabel" htmlFor="r2-bal-select">Card</label>
                      <select
                        id="r2-bal-select"
                        className="r2-fold-cardsel"
                        value={safeIdx}
                        onChange={e => setBalanceCardIdx(Number(e.target.value))}
                      >
                        {ownedVerdicts.map((v, i) => (
                          <option key={v.cardId} value={i}>{v.cardName}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <AprEmiCalculator
                    cardName={balCard.cardName}
                    storedAprAnnualPct={balLiq?.aprAnnualPct ?? null}
                    storedEmiAprAnnualPct={balLiq?.emiConversionAprPct ?? null}
                  />
                </div>
              </details>
            );
          })()}
          {/* ── Nav buttons ── */}
          {(onBack || onRestart) && (
            <div className="r2-nav">
              {onBack && <button className="r2-back" onClick={onBack}>Back</button>}
              {onRestart && <button className="r2-restart" onClick={onRestart}>Start over</button>}
            </div>
          )}
        </div>

      </div>

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

/* Back card — bottom-left offset */
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
.r2-pc-num{position:absolute;bottom:40px;left:20px;font-family:'Courier New',monospace;
  font-size:10px;letter-spacing:.13em;opacity:.45;color:#fff;pointer-events:none}
.r2-pc-holder{position:absolute;bottom:18px;right:20px;font-size:8.5px;
  text-transform:uppercase;letter-spacing:.1em;opacity:.38;color:#fff;pointer-events:none}
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
.r2-hack-seehow{
  background:none;border:none;color:#8b5cf6;font-family:inherit;font-size:13px;
  font-weight:600;cursor:pointer;padding:8px 0 2px;display:block}
.r2-hack-seehow:hover{color:#a78bfa}

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

/* ── Combo hero fee note ── */
.r2-combo-feenote{font-size:12px;color:#52525b;margin-top:-12px;margin-bottom:18px;line-height:1.4}
.r2-combo-feenote.waived{color:#10b981}

/* ── Combo Math fee line + net line (mirrors CardMathBreakdown) ── */
.r2-math-feeline{
  display:flex;justify-content:space-between;align-items:baseline;
  padding:8px 0 0;margin-top:6px;border-top:1px solid #1f1f23;font-size:13px}
.r2-math-fee-label{color:#a1a1aa;display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
.r2-math-fee-strike{text-decoration:line-through;color:#52525b}
.r2-math-fee-waived{color:#10b981;font-weight:600;font-size:12px}
.r2-math-fee-val{color:#a1a1aa;font-weight:600;font-variant-numeric:tabular-nums;flex-shrink:0}
.r2-math-cardnet{
  display:flex;justify-content:space-between;align-items:baseline;
  padding:8px 0 0;margin-top:4px;border-top:1px solid #27272a}
.r2-math-cardnet>span:first-child{font-size:13px;font-weight:700;color:#fafafa}
.r2-math-cardnet-val{font-size:22px;font-weight:800;color:#10b981;
  font-variant-numeric:tabular-nums;letter-spacing:-.02em}

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

/* ── Stage 4: Lower horizontal tabs ── */
.r2-lowtabrow{
  display:flex;border-top:1px solid #1f1f23;border-bottom:1px solid #1f1f23;
  margin-top:20px;padding-top:4px}
.r2-lowtabbtn{
  flex:1;font-family:'DM Sans',system-ui,sans-serif;background:none;border:none;
  padding:12px 6px 13px;font-size:11.5px;font-weight:600;color:#52525b;
  cursor:pointer;text-align:center;border-bottom:2px solid transparent;
  margin-bottom:-1px;transition:color .15s,border-color .15s;line-height:1.3;
  position:relative}
.r2-lowtabbtn:not(:last-child)::after{
  content:'';position:absolute;right:0;top:22%;height:56%;
  width:1px;background:#27272a}
.r2-lowtabbtn:hover{color:#a1a1aa}
.r2-lowtabbtn.on{color:#fafafa;border-bottom-color:#10b981}

.r2-lowcontent{
  background:#0c0c0e;border:1px solid #1f1f23;border-top:none;
  border-radius:0 0 12px 12px;padding:14px 16px}

/* item rows */
.r2-lc-item{
  display:flex;justify-content:space-between;align-items:baseline;
  font-size:13px;color:#d4d4d8;padding:8px 0;
  border-bottom:1px solid #141416}
.r2-lc-item:last-of-type{border-bottom:none}
.r2-lc-name{color:#fafafa;font-weight:600;display:flex;align-items:center;gap:8px}
.r2-lc-val{color:#a1a1aa;flex-shrink:0;font-variant-numeric:tabular-nums}
.r2-lc-badge{
  background:#18181b;color:#a78bfa;font-size:9.5px;font-weight:700;
  text-transform:uppercase;letter-spacing:.04em;padding:2px 6px;
  border-radius:5px;border:1px solid #8b5cf633}
.r2-lc-note{font-size:12px;color:#52525b;line-height:1.55;padding-top:2px}

/* eligibility rows */
.r2-elig{display:flex;align-items:center;gap:10px;font-size:13px;
  padding:7px 0;border-bottom:1px solid #141416}
.r2-elig:last-of-type{border-bottom:none}
.r2-elig-n{font-size:15px;font-weight:700;width:46px;flex-shrink:0}
.r2-elig.yes .r2-elig-n{color:#10b981}
.r2-elig.no .r2-elig-n{color:#3f3f46}
.r2-elig-t{color:#d4d4d8}
.r2-elig.no .r2-elig-t{color:#71717a}

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

/* ── Stage 7: Transfer callout box ── */
.r2-xfr-box{
  margin-top:14px;margin-bottom:4px;
  border-radius:14px;
  background:linear-gradient(#09090b,#09090b) padding-box,
             linear-gradient(135deg,#06b6d4 0%,#8b5cf6 100%) border-box;
  border:1px solid transparent;
  box-shadow:0 0 0 1px rgba(6,182,212,.10),
             0 6px 24px rgba(6,182,212,.07),
             0 6px 24px rgba(139,92,246,.05);
  overflow:hidden}

/* Header — acts as the collapse toggle */
.r2-xfr-head{
  display:flex;align-items:center;gap:9px;width:100%;
  font-family:'DM Sans',system-ui,sans-serif;
  font-size:13.5px;font-weight:800;color:#fafafa;
  background:none;border:none;cursor:pointer;
  padding:16px 18px;text-align:left;line-height:1.3}
.r2-xfr-head:hover{background:rgba(255,255,255,.02)}
.r2-xfr-icon{color:#06b6d4;flex-shrink:0}
.r2-xfr-chev{
  margin-left:auto;color:#52525b;font-size:18px;line-height:1;
  transition:transform .2s;display:inline-block;transform:rotate(90deg)}
.r2-xfr-chev.open{transform:rotate(-90deg)}

/* Expanded body */
.r2-xfr-body{padding:0 18px 16px;border-top:1px solid rgba(255,255,255,.05)}
.r2-xfr-desc{
  font-size:12.5px;color:#71717a;line-height:1.6;margin:12px 0 14px}

.r2-xfr-rows{display:flex;flex-direction:column;gap:10px;margin-bottom:14px}
.r2-xfr-row{display:flex;gap:10px;align-items:flex-start}
.r2-xfr-pill{
  flex-shrink:0;font-size:9.5px;font-weight:700;text-transform:uppercase;
  letter-spacing:.06em;padding:3px 8px;border-radius:6px;margin-top:2px}
.r2-xfr-pill.flight{background:rgba(6,182,212,.12);color:#06b6d4;border:1px solid rgba(6,182,212,.2)}
.r2-xfr-pill.hotel{background:rgba(139,92,246,.12);color:#a78bfa;border:1px solid rgba(139,92,246,.2)}
.r2-xfr-text{font-size:12.5px;color:#a1a1aa;line-height:1.6}

.r2-xfr-partners{
  display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
.r2-xfr-partner{
  font-size:11px;font-weight:600;padding:4px 9px;border-radius:7px;
  display:flex;align-items:center;gap:5px;line-height:1}
.r2-xfr-partner.airline{background:rgba(6,182,212,.08);color:#67e8f9;border:1px solid rgba(6,182,212,.15)}
.r2-xfr-partner.hotel{background:rgba(139,92,246,.08);color:#c4b5fd;border:1px solid rgba(139,92,246,.15)}
.r2-xfr-partner.portal{background:rgba(16,185,129,.08);color:#6ee7b7;border:1px solid rgba(16,185,129,.15)}
.r2-xfr-ratio{
  font-size:10px;font-weight:700;opacity:.7;
  background:rgba(255,255,255,.06);padding:1px 5px;border-radius:4px}

.r2-xfr-seehow{
  background:none;border:none;color:#06b6d4;font-family:inherit;font-size:13px;
  font-weight:600;cursor:pointer;padding:4px 0 8px;display:block}
.r2-xfr-seehow:hover{color:#67e8f9}
/* XFR steps use same r2-steps / r2-step / r2-sn layout as hack panel */
.r2-xfr-steps{margin-top:4px;margin-bottom:8px}
.r2-sn.xfr{background:rgba(6,182,212,.12);color:#06b6d4}

.r2-xfr-foot{
  font-size:10.5px;color:#3f3f46;line-height:1.5;
  padding-top:10px;border-top:1px solid rgba(255,255,255,.05)}

/* ── Credit note ── */
.r2-creditnote{
  margin-top:14px;padding:10px 14px;border-radius:10px;font-size:12.5px;
  color:#fbbf24;background:rgba(251,191,36,.07);border:1px solid rgba(251,191,36,.18);
  line-height:1.55}

/* ── Nav ── */
.r2-nav{display:flex;gap:8px;margin-top:16px}
.r2-back{flex:1;background:#27272a;border:1px solid #52525b;color:#fafafa;
  font-family:inherit;font-size:13px;font-weight:700;padding:11px;border-radius:10px;cursor:pointer}
.r2-back:hover{background:#3f3f46;border-color:#71717a}
.r2-restart{flex:1;background:#18181b;border:1px solid #3f3f46;color:#d4d4d8;
  font-family:inherit;font-size:13px;font-weight:600;padding:11px;border-radius:10px;cursor:pointer}
.r2-restart:hover{background:#27272a;border-color:#52525b;color:#fafafa}

/* ── Owned verdicts (Journey A) ── */
.r2-verdict{
  background:#0a1f16;border:1px solid #1a6b46;border-radius:12px;
  padding:14px;display:flex;flex-direction:column;gap:9px;margin-bottom:20px}
.r2-vrow{display:flex;align-items:baseline;gap:10px}
.r2-vbadge{font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;
  padding:3px 7px;border-radius:5px;flex:0 0 auto}
.r2-v-keep .r2-vbadge{background:#0d2c1c;color:#34d399;border:1px solid #1a6b46}
.r2-v-underused .r2-vbadge{background:#2a2406;color:#fbbf24;border:1px solid #6b5410}
.r2-v-wrong_fit .r2-vbadge{background:#2a0f0f;color:#f87171;border:1px solid #6b1d1d}
.r2-vreason{font-size:13px;color:#d4d4d8;line-height:1.5}
.r2-vname{color:#fafafa}

/* ── Verdict-on-tile (Journey A owned cards) ── */
.r2-pc-verdict{margin-top:5px;display:flex;flex-direction:column;gap:3px}
/* Solid dark chip so badge reads on ANY tile gradient (light red, dark navy, etc).
   Semantic colour is the text, not the background — fixes the contrast-on-light-tile class of bugs. */
.r2-pc-vbadge{
  display:inline-block;font-size:8px;font-weight:800;text-transform:uppercase;
  letter-spacing:.06em;padding:2px 7px;border-radius:4px;align-self:flex-start;
  background:rgba(0,0,0,.58);backdrop-filter:blur(2px)}
.r2-vpc-keep{color:#4ade80}
.r2-vpc-underused{color:#fbbf24}
.r2-vpc-wrong_fit{color:#f87171}
.r2-pc-vline{font-size:9px;color:rgba(255,255,255,.70);line-height:1.45;margin-top:2px;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}

/* ── Owned-card carousel (Journey A) ── */
.r2-owned-carousel{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.r2-carousel-arrow{
  flex-shrink:0;width:32px;height:32px;border-radius:50%;
  background:#18181b;border:1px solid #3f3f46;color:#a1a1aa;
  font-size:20px;line-height:1;cursor:pointer;
  display:flex;align-items:center;justify-content:center;
  transition:background .15s,border-color .15s,color .15s;
  font-family:inherit;padding:0;margin-bottom:34px}
.r2-carousel-arrow:hover{background:#27272a;border-color:#71717a;color:#fafafa}
.r2-carousel-body{flex:1;min-width:0}
.r2-carousel-dots{display:flex;justify-content:center;gap:6px;margin-top:8px}
.r2-carousel-dot{
  width:7px;height:7px;border-radius:50%;
  background:#3f3f46;border:none;cursor:pointer;padding:0;
  transition:background .15s,transform .15s}
.r2-carousel-dot.on{background:#10b981;transform:scale(1.25)}

/* ── Journey A: smaller tiles so both carousel + recommendation fit without scrolling ── */
/* Scope under r2-left--a so combo stack (r2-left without modifier) is untouched. */
.r2-left--a .r2-pcard{width:210px;height:132px;border-radius:14px;padding:16px}
.r2-left--a .r2-chip{width:24px;height:17px;border-radius:3px;margin-bottom:9px}
.r2-left--a .r2-pc-name{font-size:13px}
.r2-left--a .r2-pc-cats{font-size:9.5px}
.r2-left--a .r2-pc-num{font-size:8.5px;bottom:32px}
.r2-left--a .r2-pc-holder{font-size:7px;bottom:14px}
.r2-left--a .r2-pc-verdict{margin-top:4px;gap:2px}
.r2-left--a .r2-pc-vbadge{font-size:7px;padding:1px 5px}
.r2-left--a .r2-pc-vline{font-size:8px}
.r2-left--a .r2-solo-stack{height:168px;margin-bottom:8px}
.r2-left--a .r2-hero-num{font-size:26px}
.r2-left--a .r2-hero-yr{font-size:16px}

/* ── Hero row — flex to place ⓘ button beside the number ── */
.r2-hero-row{display:flex;align-items:center;gap:10px}

/* ── Clarity info button + popover ── */
.r2-clarity-btn{
  flex-shrink:0;background:none;border:none;cursor:pointer;
  font-size:16px;color:#52525b;line-height:1;padding:2px;
  transition:color .15s;margin-bottom:2px}
.r2-clarity-btn:hover,.r2-clarity-btn.on{color:#a1a1aa}
.r2-clarity-popover{
  font-size:12px;color:#71717a;line-height:1.6;
  background:#0c0c0e;border:1px solid #27272a;border-radius:10px;
  padding:10px 13px;margin-top:6px;margin-bottom:10px}

/* ── Owned card stack supporting text ── */
.r2-owned-divider{border:none;border-top:1px solid #27272a;margin:20px 0 16px}

/* ── AprEmiCalculator font overrides for V2's compact right column ── */
.r2-fold .wf-apr-title{font-size:14px!important}
.r2-fold .wf-stat-val{font-size:18px!important}
.r2-fold .wf-field input{font-size:13px!important}
.r2-fold .wf-rate-num{font-size:13px!important}

/* ── Balance calculator fold (Journey A, above nav buttons in right column) ── */
.r2-fold{
  background:#0c0c0e;border:1px solid #27272a;border-radius:12px;
  overflow:hidden;margin-top:14px}
.r2-fold>summary{
  list-style:none;cursor:pointer;padding:14px 16px;font-size:13px;
  font-weight:600;color:#a1a1aa;display:flex;justify-content:space-between;align-items:center}
.r2-fold>summary::-webkit-details-marker{display:none}
.r2-fold>summary:hover{color:#e4e4e7}
.r2-fold>summary::after{content:'⌄';font-size:16px;color:#52525b;transition:transform .2s}
.r2-fold[open]>summary::after{transform:rotate(180deg)}
.r2-fold[open]>summary{border-bottom:1px solid #1f1f23}
.r2-fold-body{padding:8px 0 0}

/* ── Balance calc card picker (Journey A) ── */
.r2-fold-cardpick{display:flex;align-items:center;gap:8px;padding:10px 16px 0}
.r2-fold-cardlabel{font-size:11px;font-weight:700;color:#71717a;flex-shrink:0;text-transform:uppercase;letter-spacing:.05em}
.r2-fold-cardsel{
  flex:1;background:#18181b;border:1px solid #3f3f46;border-radius:8px;
  color:#e4e4e7;font-family:'DM Sans',system-ui,sans-serif;font-size:13px;
  font-weight:600;padding:6px 10px;cursor:pointer;outline:none}
.r2-fold-cardsel:focus{border-color:#71717a}
`;

export default ResultsScreenV2;
