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
import type { RankResult, RankedCard, CardMeta, LoungeBlock, Priorities, PriorityKey, OwnedCategoryRoute } from '../../lib/cardEngine/rankCards';
import type { MonthlySpend, CategoryEarn } from '../../lib/cardEngine/computeEarn';
import { evalPriorityForCard, LABEL, type AlternativeForPriority } from '../../lib/cardEngine/evaluatePriorities';
import { resolveTileColor } from './CardTile';
import { CardMathBreakdown } from './CardMathBreakdown';
import RecommendationCard, { type DevaluationFlag } from './RecommendationCard';
import type { SelectedHack, SurfacedInsight } from '../../lib/cardEngine/selectHacks';
import { LABEL as PRIORITY_LABEL } from '../../lib/cardEngine/evaluatePriorities';
import { CATEGORY_LABELS } from './SpendInput';

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
const difficultyLabel = (d: string) =>
  d === 'Beginner' ? 'Easy' : d === 'Intermediate' ? 'Medium' : d === 'Advanced' ? 'Hard' : d;

interface Props {
  result: RankResult;
  monthlySpend: MonthlySpend;
  isTravelPriority?: boolean;
  devaluations?: Record<string, DevaluationFlag>;
  hacks?: Record<string, SelectedHack | null>;
  intelligence?: Record<string, { type: string; text: string; severity?: string | null; isGroup?: boolean }[]>;
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
  { key: 'hack',       label: 'Pro Tips',         Icon: Zap,        accent: '#8b5cf6' },
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

  // Phase 2 (recommendation + icon panels) open/closed in Journey A Model B layout.
  const [phase2Open, setPhase2Open] = useState(false);

  // Which detail panel is open (null = all closed; user must click to open).
  const [activeIcon, setActiveIcon] = useState<IconKey | null>(null);
  const toggleIcon = (key: IconKey) => setActiveIcon(prev => prev === key ? null : key);

  // Hack steps expansion (collapses when icon panel switches card).
  const [hackStepsOpen, setHackStepsOpen] = useState(false);

  // Shared "Things to know" panel — splits card-specific (single-card warnings) from group (multi-card).
  const KnowPanel = ({ intel }: { intel: { type: string; text: string; severity?: string | null; isGroup?: boolean }[] }) => {
    const specific = intel.filter(it => !it.isGroup);
    if (specific.length === 0) return <div className="r2-panel-know"><div className="r2-empty">No current alerts or notable changes for this card.</div></div>;
    return (
      <div className="r2-panel-know">
        {specific.map((item, i) => (
          <div key={i} className={'r2-item know ' + (item.severity ?? '')}>
            <span className="r2-know-dot" /><span>{item.text}</span>
          </div>
        ))}
      </div>
    );
  };

  // Phase 1 icon panels for active owned card (separate from Phase 2's activeIcon).
  type P1IconKey = 'why' | 'cat' | 'hack' | 'transfer' | 'know';
  const [p1ActiveIcon, setP1ActiveIcon] = useState<P1IconKey | null>('why');
  const toggleP1Icon = (key: P1IconKey) => setP1ActiveIcon(prev => prev === key ? null : key);

  // Hack steps for Phase 1 owned card (separate from Phase 2 hackStepsOpen).
  const [p1HackStepsOpen, setP1HackStepsOpen] = useState(false);

  // Reward-rate % toggle inside owned-card "Why" panel.
  const [showRates, setShowRates] = useState(false);
  const [showWhyTable, setShowWhyTable] = useState(false);

  // Alt-card expansion (single-card view only).
  const [altExpanded, setAltExpanded] = useState(false);

  // "See how" breakdown open/closed in Phase 2.
  const [seeHowOpen, setSeeHowOpen] = useState(false);

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

  // ── Plain-English priority line formatter (display layer only) ────────────
  const FOREX_BENCHMARK_PCT = 3.5;
  const CAT_LABEL = CATEGORY_LABELS;
  function periodMult(period: string | null): number {
    switch ((period ?? 'month').toLowerCase()) {
      case 'year': return 12; case 'quarter': return 3; default: return 1;
    }
  }
  function priLine(key: PriorityKey, card: RankedCard, spend: MonthlySpend): string {
    const meta = card.meta as CardMeta;
    switch (key) {
      case 'Forex': {
        const f = meta.forexPct ?? 0;
        if (f < FOREX_BENCHMARK_PCT)
          return `Spending abroad: charges ${f}% extra. Most cards charge ${FOREX_BENCHMARK_PCT}% — so it's cheaper on foreign trips.`;
        return `Spending abroad: charges ${f}% extra — that's on the higher side.`;
      }
      case 'Lounge': {
        const ls = meta.loungeStructured;
        const blocks: { label: string; block: LoungeBlock | null }[] = [
          { label: 'domestic', block: ls?.domestic ?? null },
          { label: 'international', block: ls?.international ?? null },
          { label: 'railway', block: ls?.railway ?? null },
        ];
        const monthly = Object.values(spend).reduce((s, v) => s + (v ?? 0), 0);
        let best: { rank: number; line: string } | null = null;
        for (const { label, block } of blocks) {
          if (!block) continue;
          const threshold = block.spendThreshold ?? 0;
          const tPeriod = block.thresholdPeriod;
          const userPeriodSpend = monthly * periodMult(tPeriod);
          const qty = block.unlimited
            ? 'unlimited'
            : `${block.visits ?? 0} ${label}${block.visitPeriod ? `/${block.visitPeriod}` : ''}`;
          let rank: number; let line: string;
          if (threshold <= 0) {
            rank = 2;
            line = `Airport lounge: ${qty} free visits a year — no conditions.`;
          } else if (userPeriodSpend >= threshold) {
            rank = 1;
            line = `Airport lounge: ${qty} free visits. You already spend enough to get these.`;
          } else {
            rank = 0;
            const periodLabel = tPeriod ?? 'month';
            line = `Airport lounge: ${qty} free visits, but only if you spend ${inr(threshold)}/${periodLabel}. You spend ${inr(userPeriodSpend)} — so you won't get them.`;
          }
          if (!best || rank > best.rank) best = { rank, line };
        }
        return best?.line ?? 'No free airport lounge visits.';
      }
      case 'Movies': {
        const m = meta.movieStructured;
        if (!m || m.type === 'NONE') return 'No discount on movie tickets.';
        const desc =
          m.type === 'BOGO' ? 'Buy-one-get-one on movie tickets' :
          m.type === 'DISCOUNT' ? 'Discount on movie tickets' : 'Movie ticket benefit';
        const value = m.annualValueComputed;
        return value != null ? `${desc} — worth about ${inr(value)} a year.` : `${desc}.`;
      }
      case 'Cashback':
        if (meta.rewardType === 'cashback')
          return 'Gives you real cashback — money straight back, nothing to collect or redeem.';
        return 'You wanted cashback. This card gives points instead — you collect them and use them later, not money straight back.';
      case 'Rewards':
        if (meta.rewardType === 'points')
          return 'Earns reward points you can redeem for travel, vouchers, or cashback.';
        return 'Earns direct cashback rather than points.';
      default: {
        // Category priorities: Travel, Dining, Fuel, Online
        const catMap: Partial<Record<PriorityKey, string>> = {
          Travel: 'Travel', Dining: 'Dining', Fuel: 'Fuel', Online: 'Online',
        };
        const cat = catMap[key];
        if (!cat) return '';
        const label = (CAT_LABEL as Record<string, string>)[cat] ?? cat;
        const perYear = (card.earn.perCategory[cat as keyof typeof card.earn.perCategory]?.guaranteed ?? 0) * 12;
        if (perYear > 0) return `${label}: gives you back ${inr(perYear)} a year.`;
        return `${label}: gives you nothing back.`;
      }
    }
  }

  return (
    <div className="r2-shell">
      <style>{css}</style>

      {/* ── Stage 5: decorative background layer — additive only, behind all content ── */}
      <div className="r2-bg" aria-hidden="true">
        <svg className="r2-bg-svg" preserveAspectRatio="none" viewBox="0 0 1600 900">
          <g className="r2-bg-lines">
            <path d="M0,300 C400,180 760,440 1600,240" stroke="#10b98138" strokeWidth="2" fill="none" />
            <path d="M0,560 C520,700 1040,420 1600,640" stroke="#8b5cf632" strokeWidth="2" fill="none" />
            <path d="M0,180 C620,120 1120,420 1600,160" stroke="#06b6d42e" strokeWidth="2" fill="none" />
            <path d="M0,760 C460,640 980,820 1600,720" stroke="#f59e0b26" strokeWidth="2" fill="none" />
          </g>
        </svg>
        <div className="r2-floatcirc fc1" style={{ borderColor: '#8b5cf6', color: '#8b5cf6' }}>₹</div>
        <div className="r2-floatcirc fc2" style={{ borderColor: '#10b981', color: '#10b981' }}>∑</div>
        <div className="r2-floatcirc fc3" style={{ borderColor: '#06b6d4', color: '#06b6d4' }}>∿</div>
        <div className="r2-floatcirc fc4" style={{ borderColor: '#f59e0b', color: '#f59e0b' }}>↗</div>
      </div>

      <div className="r2-grid">

        {/* ── LEFT: sticky hero column ── */}
        <div className={'r2-left' + (journeyA ? ' r2-left--a' : '')}>
          {journeyA && result.ownedVerdicts && result.ownedVerdicts.length > 0 ? (
            /* ── Journey A: owned-card carousel ── */
            (() => {
              const verdicts = result.ownedVerdicts!;
              const N = verdicts.length;
              const fi = ownedFrontIdx % N;
              const activeV = verdicts[fi];
              const toStub = (v: typeof activeV) => ({ meta: { name: v.cardName, bank: v.bank } });
              const prev = () => { setOwnedFrontIdx(i => (i - 1 + N) % N); setP1ActiveIcon('why'); setP1HackStepsOpen(false); };
              const next = () => { setOwnedFrontIdx(i => (i + 1) % N); setP1ActiveIcon('why'); setP1HackStepsOpen(false); };
              return (
                <>
                  <div className="r2-eyebrow">Your cards</div>
                  {N === 1 ? (
                    <>
                      <div className="r2-solo-stack">
                        <PCard card={toStub(activeV)} cats="" net={activeV.netPerYear} hideNet
                          verdictBadge={activeV.verdict.replace('_', ' ')}
                          className="r2-pcard-solo" />
                      </div>
                      {activeV.reason && <div className="r2-owned-earn-line">{activeV.reason}</div>}
                    </>
                  ) : (
                    <>
                      <div className="r2-owned-carousel">
                        <button className="r2-carousel-arrow" onClick={prev} aria-label="Previous card">‹</button>
                        <div className="r2-carousel-body">
                          <PCard card={toStub(activeV)} cats="" net={activeV.netPerYear} hideNet
                            verdictBadge={activeV.verdict.replace('_', ' ')}
                            className="r2-pcard-solo r2-pcard-flow" />
                          <div className="r2-carousel-dots">
                            {verdicts.map((_, i) => (
                              <button key={i} className={'r2-carousel-dot' + (i === fi ? ' on' : '')}
                                onClick={() => { setOwnedFrontIdx(i); setP1ActiveIcon('why'); setP1HackStepsOpen(false); }}
                                aria-label={`Go to card ${i + 1}`} />
                            ))}
                          </div>
                        </div>
                        <button className="r2-carousel-arrow" onClick={next} aria-label="Next card">›</button>
                      </div>
                      {activeV.reason && <div className="r2-owned-earn-line">{activeV.reason}</div>}
                    </>
                  )}
                </>
              );
            })()
          ) : comboHero && front && back && combo ? (
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
              {/* ── Journey B: classic single-card layout (recommendation first, no phases) ── */}
              {!journeyA && (
                <>
                  <div className="r2-eyebrow">Your #1 fit</div>
                  <div className="r2-hero-num">
                    {inr(top.netGuaranteedPerYear)}<span className="r2-hero-yr">/yr</span>
                  </div>
                  <div className="r2-hero-sub">
                    annual net benefit · <b>{top.meta.name}</b>
                  </div>
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
              )}
            </>
          ) : null}
        </div>

        {/* ── RIGHT / PHASE CONTAINER ── */}
        <div className="r2-right">

          {/* ══════════════════════════════════════════════════════════════════
              JOURNEY A — Model B two-phase layout
              Phase 1: owned-card analysis (always visible)
              Phase 2: recommendation + icon panels (collapsed behind CTA)
          ══════════════════════════════════════════════════════════════════ */}
          {journeyA ? (
            <div className="r2-phase1">

                {result.ownedVerdicts && result.ownedVerdicts.length > 0 && (() => {
                  const verdicts = result.ownedVerdicts!;
                  const N = verdicts.length;
                  const fi = ownedFrontIdx % N;
                  const activeV = verdicts[fi];
                  const activeCardId = activeV.cardId;

                  const p1Hack = hacks?.[activeCardId] ?? null;
                  const p1Transfer = transferHacks?.[activeCardId];
                  const p1Partners = transferPartners?.[activeCardId] ?? [];
                  const hasTransfer = !!(p1Transfer?.displayTravelHack);

                  const p1Intel = intelligence?.[activeCardId] ?? [];
                  const whyLabel =
                    activeV.verdict === 'keep'       ? 'Why keep this'   :
                    activeV.verdict === 'wrong_fit'  ? 'Why drop this'   :
                    activeV.verdict === 'underused'  ? 'Why use it more' :
                                                       'Why we say this';
                  const P1_ICONS: { key: P1IconKey; label: string; Icon: typeof Scale; accent: string }[] = [
                    { key: 'why',      label: whyLabel,           Icon: Scale,      accent: '#10b981' },
                    { key: 'hack',     label: 'Pro Tips',         Icon: Zap,        accent: '#8b5cf6' },
                    ...(hasTransfer ? [{ key: 'transfer' as P1IconKey, label: 'Flights & hotels', Icon: Plane, accent: '#f59e0b' }] : []),
                    { key: 'know',     label: 'Things to know',   Icon: Info,       accent: '#f59e0b' },
                  ];

                  const p1IconCfg = P1_ICONS.find(i => i.key === p1ActiveIcon);

                  return (
                    <>
                      {/* Phase 1 icon row */}
                      <div className="r2-iconrow">
                        {P1_ICONS.map(({ key, label, Icon, accent }) => (
                          <button
                            key={key}
                            className={'r2-iconcircle' + (p1ActiveIcon === key ? ' on' : '')}
                            style={{ '--r2-accent': accent } as React.CSSProperties}
                            onClick={() => toggleP1Icon(key)}
                            aria-label={label}
                            aria-pressed={p1ActiveIcon === key}
                          >
                            <div className="r2-circ"><Icon size={20} strokeWidth={1.75} /></div>
                            <span className="r2-lbl">{label}</span>
                          </button>
                        ))}
                      </div>

                      {/* Phase 1 detail panel */}
                      {p1ActiveIcon && p1IconCfg && (
                        <div className="r2-detail" style={{ '--r2-accent': p1IconCfg.accent } as React.CSSProperties}>
                          <div className="r2-detail-which">{activeV.cardName}</div>

                          {/* Icon 1 — Why [verdict]: 3-level owned-card breakdown */}
                          {p1ActiveIcon === 'why' && (() => {
                            const cardProof = result.ownedPerCategory?.[activeCardId];
                            if (!cardProof) return <div className="r2-empty">No breakdown available.</div>;
                            const spendCats = (Object.keys(monthlySpend) as (keyof typeof monthlySpend)[])
                              .filter(c => (monthlySpend[c] ?? 0) > 0);

                            // Plain category name helper
                            const catName = (cat: string) => (CAT_LABEL as Record<string, string>)[cat] ?? (cat === 'Other(base)' ? 'Everything else' : cat);

                            // ── Shared routing vars for all verdict branches ──
                            const bpcShared = result.bestCardPerCategory ?? {};
                            const wonCatsShared = spendCats.filter(c => bpcShared[c]?.cardId === activeCardId && (bpcShared[c]?.guaranteed ?? 0) > 0);
                            const wonLabelShared = wonCatsShared.length > 0
                              ? wonCatsShared.map(c => (CAT_LABEL as Record<string, string>)[c] ?? (c === 'Other(base)' ? 'everything else' : c)).join(' & ')
                              : null;
                            const standaloneTotalShared = spendCats.reduce((s, cat) => {
                              const ce = cardProof[cat as keyof typeof cardProof];
                              return s + (ce?.guaranteed ?? 0) * 12;
                            }, 0);

                            // ── Level ①: earn breakdown (all three verdict branches) ──────────
                            let level1: React.ReactNode;

                            if (activeV.verdict === 'underused') {
                              /* UNDERUSED: honest proof — strong card, bonuses not triggered */
                              const rows = spendCats.map(cat => {
                                const ce = cardProof[cat as keyof typeof cardProof];
                                return {
                                  cat,
                                  guaranteed: (ce?.guaranteed ?? 0) * 12,
                                  upside: (ce?.upside ?? 0) * 12,
                                  rate: ce?.baseRatePer100 ?? 0,
                                };
                              }).sort((a, b) => (b.guaranteed + b.upside) - (a.guaranteed + a.upside));
                              const totalUpside = rows.reduce((s, r) => s + r.upside, 0);
                              const hasAccelerators = totalUpside > 0;

                              // Routing explanation: column shows standalone earn, netPerYear shows wallet capture (won cats only)
                              const bpc = bpcShared;
                              const wonCats = wonCatsShared;
                              const wonLabel = wonLabelShared ?? 'no category';
                              const lostCats = spendCats.filter(c => bpc[c]?.cardId && bpc[c].cardId !== activeCardId);
                              const colSum = rows.reduce((s, r) => s + r.guaranteed, 0);
                              const hasRoutingGap = colSum > activeV.netPerYear + 50;
                              const beaterNames = [...new Set(
                                lostCats.map(c => bpc[c]?.cardName).filter((n): n is string => !!n)
                              )].slice(0, 2);
                              const lostLabel = lostCats.length > 0
                                ? lostCats.map(c => c === 'Other(base)' ? 'everything else' : c).join(', ')
                                : null;
                              const routingLine = hasRoutingGap ? (
                                <div className="r2-underused-routing">
                                  These are what it could earn. But {beaterNames.length > 0
                                    ? <>your <b>{beaterNames.join(' and ')}</b> already earn more on {lostLabel ?? 'most categories'}</>
                                    : <>your other cards earn more on {lostLabel ?? 'most categories'}</>
                                  }. So in real life this card only wins on <b>{wonLabel}</b> — {inr(activeV.netPerYear)} a year.
                                </div>
                              ) : null;

                              if (hasAccelerators) {
                                const topBonus = rows.reduce((best, r) => r.upside > best.upside ? r : best, rows[0]);
                                const wonSentence = wonCats.length > 0
                                  ? <>Your other cards already earn more on almost everything, so this is only your best card for <b>{wonLabel}</b>.</>
                                  : <>Your other cards already earn more on almost everything, so it isn&rsquo;t your best card for anything right now.</>;
                                level1 = (
                                  <>
                                    <div className="r2-vproof-head">A good card — but not for how you spend.</div>
                                    <div className="r2-underused-sentences">
                                      <p>Right now it gives you back only <b>{inr(activeV.netPerYear)}</b> a year. {wonSentence}</p>
                                      {topBonus.upside > 0 && (
                                        <p className="r2-underused-upside-line">Used right, it could earn up to <b>{inr(topBonus.upside)}</b> more a year — but only if you use the card&rsquo;s own app or website.</p>
                                      )}
                                    </div>
                                    {rows.map(r => (
                                      <div key={r.cat} className={'r2-vproof-row' + (r.guaranteed === 0 ? ' zero' : '')}>
                                        <span className="r2-vproof-cat">{catName(r.cat)}</span>
                                        <span className="r2-vproof-earn">
                                          {r.guaranteed > 0
                                            ? <>{inr(r.guaranteed)}/yr{showRates && r.rate > 0 && <span className="r2-vproof-rate"> · {r.rate.toFixed(2)}%</span>}</>
                                            : <span className="r2-vproof-zero">—</span>}
                                        </span>
                                      </div>
                                    ))}
                                  </>
                                );
                              } else {
                                // Fallback: no accelerators
                                const wonSentence = wonCats.length > 0
                                  ? <>Your other cards already earn more on almost everything, so this is only your best card for <b>{wonLabel}</b>.</>
                                  : <>Your other cards already earn more on almost everything, so it isn&rsquo;t your best card for anything right now.</>;
                                level1 = (
                                  <>
                                    <div className="r2-vproof-head">A good card — but not for how you spend.</div>
                                    <div className="r2-underused-sentences">
                                      <p>Right now it gives you back only <b>{inr(activeV.netPerYear)}</b> a year. {wonSentence}</p>
                                    </div>
                                    {rows.map(r => (
                                      <div key={r.cat} className={'r2-vproof-row' + (r.guaranteed === 0 ? ' zero' : '')}>
                                        <span className="r2-vproof-cat">{catName(r.cat)}</span>
                                        <span className="r2-vproof-earn">
                                          {r.guaranteed > 0
                                            ? <>{inr(r.guaranteed)}/yr{showRates && r.rate > 0 && <span className="r2-vproof-rate"> · {r.rate.toFixed(2)}%</span>}</>
                                            : <span className="r2-vproof-zero">—</span>}
                                        </span>
                                      </div>
                                    ))}
                                  </>
                                );
                              }
                            } else {
                              /* KEEP / WRONG_FIT: earn table */
                              // No additional vars needed — use wonLabelShared / standaloneTotalShared
                              const isWrongFit = activeV.verdict === 'wrong_fit';
                              level1 = (
                                <>
                                  {spendCats.map(cat => {
                                    const ce = cardProof[cat as keyof typeof cardProof];
                                    const isBest = result.bestCardPerCategory?.[cat]?.cardId === activeCardId;
                                    const earn = ce?.guaranteed ?? 0;
                                    return (
                                      <div key={cat} className={'r2-vproof-row' + (isBest && earn > 0 ? ' best' : '') + (earn === 0 ? ' zero' : '')}>
                                        <span className="r2-vproof-cat">{catName(cat)}</span>
                                        <span className="r2-vproof-earn">
                                          {earn > 0 ? (
                                            <>{inr(earn * 12)}/yr{showRates && ce!.baseRatePer100 > 0 && <span className="r2-vproof-rate"> · {ce!.baseRatePer100.toFixed(2)}%</span>}</>
                                          ) : ce?.excluded ? (
                                            <span className="r2-vproof-excl">excluded</span>
                                          ) : ce?.noData ? (
                                            <span className="r2-vproof-nodata">no data</span>
                                          ) : (
                                            <span className="r2-vproof-zero">not earned</span>
                                          )}
                                        </span>
                                        {isBest && earn > 0 && <span className="r2-vproof-best">best</span>}
                                      </div>
                                    );
                                  })}
                                </>
                              );
                            }

                            // ── Level ②: priorities ───────────────────────────────────────────
                            const p1PriorityKeys: PriorityKey[] = [
                              ...(priorities?.top ? [priorities.top] : []),
                              ...(priorities?.secondary ? [priorities.secondary] : []),
                              ...(priorities?.niceToHave ? [priorities.niceToHave] : []),
                            ];
                            const ownedCardObj = result.ownedRanked?.find(c => c.cardId === activeCardId);
                            const level2 = ownedCardObj && p1PriorityKeys.length > 0 ? (
                              p1PriorityKeys.map(key => {
                                const ev = evalPriorityForCard(key, ownedCardObj, monthlySpend);
                                const displayLine = priLine(key, ownedCardObj, monthlySpend);
                                return (
                                  <div key={key} className={'r2-pri-row ' + ev.status}>
                                    <span className="r2-pri-glyph">{ev.status === 'met' ? '✓' : ev.status === 'partial' ? '○' : '✗'}</span>
                                    <div>
                                      <div className="r2-pri-label">{LABEL[key]}</div>
                                      {displayLine && <div className="r2-pri-line">{displayLine}</div>}
                                    </div>
                                  </div>
                                );
                              })
                            ) : null;

                            // ── Level ③: excluded categories the user spends in ───────────────
                            const excludedCats = spendCats.filter(cat => {
                              const ce = cardProof[cat as keyof typeof cardProof];
                              return ce?.excluded === true && (monthlySpend[cat as keyof typeof monthlySpend] ?? 0) > 0;
                            });
                            const excludedAnnualSpend = excludedCats.reduce(
                              (s, cat) => s + (monthlySpend[cat as keyof typeof monthlySpend] ?? 0) * 12, 0
                            );
                            const level3 = excludedCats.length > 0 ? (
                              <div className="r2-why-excluded">
                                Pays nothing on <b>{excludedCats.map(catName).join(', ')}</b>. You spend about <b>{inr(excludedAnnualSpend)}</b> a year there — use a different card for {excludedCats.map(catName).join(', ')}.
                              </div>
                            ) : null;

                            return (
                              <div className="r2-why-levels">
                                {/* Verdict one-liner — always visible */}
                                <div className="r2-verdict-oneliner">
                                  {activeV.verdict === 'keep' && (
                                    wonLabelShared
                                      ? <>Keep this card — you earn the best rate on <b>{wonLabelShared}</b>. It gives you back <b>{inr(standaloneTotalShared)}</b> a year.</>
                                      : <>Keep this card — it earns well across your spending. It gives you back <b>{inr(standaloneTotalShared)}</b> a year.</>
                                  )}
                                  {activeV.verdict === 'wrong_fit' && (
                                    <>You can drop this — on everything you spend on, your other cards earn you more, at a better rate. So it adds nothing new to your wallet.</>
                                  )}
                                  {activeV.verdict === 'underused' && (
                                    wonLabelShared
                                      ? <>Right now this is only your best card for <b>{wonLabelShared}</b>. It can earn a lot more — see Pro Tips to unlock it.</>
                                      : <>Right now it isn&rsquo;t your best card for anything. It can earn more — see Pro Tips.</>
                                  )}
                                </div>

                                {/* Level ① */}
                                <div className="r2-why-level">
                                  <div className="r2-why-level-head">
                                    <span>What you get back in a year</span>
                                    <span className="r2-why-total">{inr(standaloneTotalShared)} back</span>
                                  </div>
                                  <button className="r2-why-rate-toggle" onClick={() => setShowWhyTable(v => !v)}>
                                    {showWhyTable ? '▾ Hide the numbers' : '▸ See the numbers'}
                                  </button>
                                  {showWhyTable && (
                                    <>
                                      <div className="r2-vproof">
                                        {level1}
                                      </div>
                                      <button className="r2-why-rate-toggle" onClick={() => setShowRates(v => !v)} style={{ marginTop: 6 }}>
                                        {showRates ? '▾ Hide reward rates' : '▸ Show reward rates'}
                                      </button>
                                    </>
                                  )}
                                </div>

                                {/* Level ② */}
                                <div className="r2-why-level">
                                  <div className="r2-why-level-head">
                                    <span>How {activeV.cardName} does on your priorities</span>
                                  </div>
                                  {p1PriorityKeys.length === 0 || !ownedCardObj
                                    ? <div className="r2-empty">You didn&rsquo;t set anything you care about.</div>
                                    : <div className="r2-panel-priorities">{level2}</div>
                                  }
                                </div>

                                {/* Level ③ — only if there are excluded cats with spend */}
                                {level3 && (
                                  <div className="r2-why-level">
                                    <div className="r2-why-level-head"><span>What it doesn&rsquo;t cover</span></div>
                                    {level3}
                                  </div>
                                )}
                              </div>
                            );
                          })()}

                          {/* Icon 2 — Per category: routing map */}
                          {p1ActiveIcon === 'cat' && (() => {
                            if (!result.bestCardPerCategory) return <div className="r2-empty">No routing data.</div>;
                            const routes = Object.entries(result.bestCardPerCategory) as [string, OwnedCategoryRoute][];
                            const sorted = routes.slice().sort((a, b) => {
                              const aLeak = !a[1].cardId; const bLeak = !b[1].cardId;
                              if (aLeak !== bLeak) return aLeak ? 1 : -1;
                              return b[1].guaranteed - a[1].guaranteed;
                            });
                            const totalAnnual = routes.reduce((s, [, r]) => s + (r.guaranteed ?? 0) * 12, 0);
                            return (
                              <>
                                <div className="r2-routemap-heading-row" style={{ marginBottom: 8 }}>
                                  <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '.06em', color: '#52525b' }}>Your best card per category</span>
                                  <span className="r2-routemap-sub">among cards you own today</span>
                                </div>
                                {sorted.map(([cat, route]) => {
                                  const isLeak = !route.cardId;
                                  const isActiveWinner = route.cardId === activeCardId;
                                  // Comparison line: show rates when another card wins
                                  const activeProof = result.ownedPerCategory?.[activeCardId];
                                  const activeCe = activeProof?.[cat as keyof typeof activeProof];
                                  const activeRate = activeCe?.baseRatePer100 ?? 0;
                                  const winnerProof = !isLeak && !isActiveWinner && route.cardId
                                    ? result.ownedPerCategory?.[route.cardId] : null;
                                  const winnerCe = winnerProof?.[cat as keyof typeof winnerProof];
                                  const winnerRate = winnerCe?.baseRatePer100 ?? route.guaranteed / (monthlySpend[cat as keyof typeof monthlySpend] ?? 1) * 100;
                                  const showCompare = !isLeak && !isActiveWinner && (winnerRate > 0 || activeRate > 0);
                                  return (
                                    <div key={cat} className={'r2-routemap-row' + (isLeak ? ' leak' : '') + (isActiveWinner ? ' active-best' : '')}>
                                      <span className="r2-routemap-cat">{cat}</span>
                                      {isLeak ? (
                                        <span className="r2-routemap-leak-note">{route.noData ? 'no rate data' : 'none earn here'}</span>
                                      ) : (
                                        <>
                                          <span className="r2-routemap-card">{isActiveWinner ? <b>{route.cardName}</b> : route.cardName}</span>
                                          <span className="r2-routemap-val">₹{Math.round(route.guaranteed * 12).toLocaleString('en-IN')}/yr</span>
                                        </>
                                      )}
                                      {showCompare && (
                                        <span className="r2-routemap-compare">
                                          {route.cardName} earns {winnerRate > 0 ? `${winnerRate.toFixed(2)}%` : 'more'} here
                                          {activeRate > 0 ? ` vs your ${activeRate.toFixed(2)}%` : activeCe?.excluded ? ' · this card excludes this category' : activeCe?.guaranteed === 0 ? ' · this card earns nothing here' : ''}
                                        </span>
                                      )}
                                    </div>
                                  );
                                })}
                                {totalAnnual > 0 && (
                                  <div className="r2-routemap-total">
                                    <span className="r2-routemap-total-lbl">Total with current setup</span>
                                    <span className="r2-routemap-total-val">₹{Math.round(totalAnnual).toLocaleString('en-IN')}/yr</span>
                                  </div>
                                )}
                              </>
                            );
                          })()}

                          {/* Icon 3 — Hacks: everyday optimisation hack for this card */}
                          {p1ActiveIcon === 'hack' && (
                            <div className="r2-panel-hack">
                              {p1Hack ? (p1Hack.locked ? (
                                <div className="r2-hackbox locked">
                                  <div className="r2-ht">{p1Hack.name}</div>
                                  <div className="r2-hd">Unlocks at <b>₹{p1Hack.locked.minMonthlySpend.toLocaleString('en-IN')}/month</b>. You&rsquo;re <b>₹{p1Hack.locked.gap.toLocaleString('en-IN')}/month</b> away.</div>
                                </div>
                              ) : (
                                <>
                                  <div className="r2-hackbox">
                                    <div className="r2-ht">{p1Hack.name}</div>
                                    <div className="r2-hd">{p1Hack.whyItMatters}</div>
                                  </div>
                                  {p1Hack.executionSteps && (
                                    <>
                                      <button className="r2-hack-seehow" onClick={() => setP1HackStepsOpen(v => !v)}>
                                        {p1HackStepsOpen ? 'Hide steps ↑' : 'See how →'}
                                      </button>
                                      {p1HackStepsOpen && <HackSteps steps={p1Hack.executionSteps} />}
                                    </>
                                  )}
                                  {p1Hack.difficulty && (
                                    <div className="r2-hack-meta">Effort: <b>{difficultyLabel(p1Hack.difficulty)}</b>{p1Hack.commonFailure && <> · Watch out for: {p1Hack.commonFailure}</>}</div>
                                  )}
                                </>
                              )) : <div className="r2-empty">No pro tip for this card yet.</div>}
                            </div>
                          )}

                          {/* Icon 4 — Flights & hotels: transfer hack (only shown when hasTransfer) */}
                          {p1ActiveIcon === 'transfer' && hasTransfer && (
                            <TransferCallout hack={p1Transfer!} partners={p1Partners} cardName={activeV.cardName} />
                          )}

                          {/* Icon 5 — Things to know: devaluation / change alerts for this owned card */}
                          {p1ActiveIcon === 'know' && <KnowPanel intel={p1Intel} />}
                        </div>
                      )}

                      {/* Best cards per category — shared collapsible, not per-card (Fix 2: above balance) */}
                      {result.bestCardPerCategory && (() => {
                        const routes = Object.entries(result.bestCardPerCategory) as [string, OwnedCategoryRoute][];
                        const sorted = routes.slice().sort((a, b) => {
                          const aLeak = !a[1].cardId; const bLeak = !b[1].cardId;
                          if (aLeak !== bLeak) return aLeak ? 1 : -1;
                          return b[1].guaranteed - a[1].guaranteed;
                        });
                        const totalAnnual = routes.reduce((s, [, r]) => s + (r.guaranteed ?? 0) * 12, 0);
                        return (
                          <details className="r2-fold">
                            <summary>Best cards in your portfolio for each spend</summary>
                            <div className="r2-fold-body">
                              <span className="r2-routemap-sub">among cards you own today</span>
                              {sorted.map(([cat, route]) => {
                                const isLeak = !route.cardId;
                                return (
                                  <div key={cat} className={'r2-routemap-row' + (isLeak ? ' leak' : '')}>
                                    <span className="r2-routemap-cat">{cat}</span>
                                    {isLeak ? (
                                      <span className="r2-routemap-leak-note">{route.noData ? 'no rate data' : 'none earn here'}</span>
                                    ) : (
                                      <>
                                        <span className="r2-routemap-card">{route.cardName}</span>
                                        <span className="r2-routemap-val">₹{Math.round(route.guaranteed * 12).toLocaleString('en-IN')}/yr</span>
                                      </>
                                    )}
                                  </div>
                                );
                              })}
                              {totalAnnual > 0 && (
                                <>
                                  <div className="r2-routemap-total">
                                    <span className="r2-routemap-total-lbl">Total with current setup</span>
                                    <span className="r2-routemap-total-val">₹{Math.round(totalAnnual).toLocaleString('en-IN')}/yr</span>
                                  </div>
                                  <div className="r2-portcard-explainer">
                                    No single card does everything well. Each one is best for a few things. Use all of them the right way and you earn <b>₹{Math.round(totalAnnual).toLocaleString('en-IN')}</b> a year — more than any card alone.
                                  </div>
                                </>
                              )}
                            </div>
                          </details>
                        );
                      })()}

                      {/* Balance calculator */}
                      {(() => {
                        const ownedVerdicts = result.ownedVerdicts!;
                        const safeIdx = balanceCardIdx % ownedVerdicts.length;
                        const balCard = ownedVerdicts[safeIdx];
                        const balLiq = liquidity?.get(balCard.cardId);
                        return (
                          <details className="r2-fold">
                            <summary>What if you don't pay the full bill? See what it costs</summary>
                            <div className="r2-fold-body">
                              {ownedVerdicts.length > 1 && (
                                <div className="r2-fold-cardpick">
                                  <label className="r2-fold-cardlabel" htmlFor="r2-bal-select">Card</label>
                                  <select id="r2-bal-select" className="r2-fold-cardsel" value={safeIdx}
                                    onChange={e => setBalanceCardIdx(Number(e.target.value))}>
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

                      {/* Broader changes collapsible — global/issuer-level warnings across all owned cards */}
                      {(() => {
                        const ownedVerdicts = result.ownedVerdicts!;
                        // Collect isGroup:true items across all owned cards, grouped by bank, de-duped by text.
                        const globalByBank = new Map<string, { text: string; severity?: string | null }[]>();
                        for (const v of ownedVerdicts) {
                          const items = (intelligence?.[v.cardId] ?? []).filter(it => it.isGroup);
                          if (items.length === 0) continue;
                          if (!globalByBank.has(v.bank)) globalByBank.set(v.bank, []);
                          const list = globalByBank.get(v.bank)!;
                          for (const it of items) {
                            if (!list.some(x => x.text === it.text)) {
                              list.push({ text: it.text, severity: it.severity });
                            }
                          }
                        }
                        if (globalByBank.size === 0) return null;
                        return (
                          <details className="r2-fold">
                            <summary>Broader changes affecting your banks</summary>
                            <div className="r2-fold-body r2-fold-global-warns">
                              {[...globalByBank.entries()].map(([bank, items]) => (
                                <div key={bank} className="r2-global-bank-group">
                                  <div className="r2-global-bank-label">{bank}</div>
                                  {items.map((it, i) => (
                                    <div key={i} className={'r2-item know ' + (it.severity ?? '')}>
                                      <span className="r2-know-dot" /><span>{it.text}</span>
                                    </div>
                                  ))}
                                </div>
                              ))}
                            </div>
                          </details>
                        );
                      })()}
                    </>
                  );
                })()}

                {/* "See what to add →" CTA — Phase 2 trigger */}
                {top && (
                  <button
                    className={'r2-phase2-cta' + (phase2Open ? ' open' : '')}
                    onClick={() => setPhase2Open(v => !v)}
                    aria-expanded={phase2Open}
                  >
                    {phase2Open
                      ? '↑ Hide recommendation'
                      : `See what to add → ${top ? top.meta.name : ''}`}
                  </button>
                )}
              </div>

          ) : (
            /* ══════════════════════════════════════════════════════════════════
                JOURNEY B — classic two-column layout (unchanged)
            ══════════════════════════════════════════════════════════════════ */
            <>
              {/* Active card drives the panel — front card in combo, top card in single */}
              {(() => {
                const activeCard = comboHero && front ? front : top;
                if (!activeCard) return null;
                const cardId = activeCard.cardId;
                const hack = hacks?.[cardId] ?? null;
                const intel = intelligence?.[cardId] ?? [];
                const narrative = narratives?.[cardId];
                const activeIconCfg = ICONS.find(i => i.key === activeIcon);
                const priorityKeys: PriorityKey[] = [
                  ...(priorities?.top ? [priorities.top] : []),
                  ...(priorities?.secondary ? [priorities.secondary] : []),
                  ...(priorities?.niceToHave ? [priorities.niceToHave] : []),
                ];
                const cardCats = comboHero && combo
                  ? (combo.assignments[cardId] ?? []).join(' · ')
                  : Object.entries(activeCard.earn.perCategory)
                      .filter(([, v]) => v.guaranteed > 0)
                      .sort(([, a], [, b]) => b.guaranteed - a.guaranteed)
                      .slice(0, 3).map(([c]) => c).join(' · ');

                return (
                  <>
                    <div className="r2-iconrow">
                      {ICONS.map(({ key, label, Icon, accent }) => (
                        <button key={key} className={'r2-iconcircle' + (activeIcon === key ? ' on' : '')}
                          style={{ '--r2-accent': accent } as React.CSSProperties}
                          onClick={() => toggleIcon(key)} aria-label={label} aria-pressed={activeIcon === key}>
                          <div className="r2-circ"><Icon size={20} strokeWidth={1.75} /></div>
                          <span className="r2-lbl">{label}</span>
                        </button>
                      ))}
                    </div>
                    {activeIcon && activeIconCfg && (
                      <div className="r2-detail" style={{ '--r2-accent': activeIconCfg.accent } as React.CSSProperties}>
                        <div className="r2-detail-which">{activeCard.meta.name}{cardCats ? ` · ${cardCats}` : ''}</div>
                        {activeIcon === 'pros' && (
                          <div className="r2-panel-pros">
                            {narrative ? (
                              <>
                                {narrative.topPros.length > 0 && <div className="r2-procon-group">{narrative.topPros.map((p, i) => (<div key={i} className="r2-item"><span className="r2-pl">+</span><span>{p.text}</span></div>))}</div>}
                                {narrative.topCons.length > 0 && <div className="r2-procon-group" style={{ marginTop: narrative.topPros.length > 0 ? '10px' : 0 }}>{narrative.topCons.map((c, i) => (<div key={i} className="r2-item"><span className="r2-mn">−</span><span>{c.text}</span></div>))}</div>}
                                {onKnowMore && <button className="r2-linkbtn" onClick={() => onKnowMore(cardId)}>See full pros &amp; cons →</button>}
                              </>
                            ) : <div className="r2-empty">No pros/cons data available.</div>}
                          </div>
                        )}
                        {activeIcon === 'hack' && (
                          <div className="r2-panel-hack">
                            {hack ? (hack.locked ? (
                              <div className="r2-hackbox locked"><div className="r2-ht">{hack.name}</div><div className="r2-hd">Unlocks at <b>₹{hack.locked.minMonthlySpend.toLocaleString('en-IN')}/month</b>. You&rsquo;re <b>₹{hack.locked.gap.toLocaleString('en-IN')}/month</b> away.</div></div>
                            ) : (
                              <>
                                <div className="r2-hackbox"><div className="r2-ht">{hack.name}</div><div className="r2-hd">{hack.whyItMatters}</div></div>
                                {hack.executionSteps && (<><button className="r2-hack-seehow" onClick={() => setHackStepsOpen(v => !v)}>{hackStepsOpen ? 'Hide steps ↑' : 'See how →'}</button>{hackStepsOpen && <HackSteps steps={hack.executionSteps} />}</>)}
                                {hack.difficulty && <div className="r2-hack-meta">Effort: <b>{difficultyLabel(hack.difficulty)}</b>{hack.commonFailure && <> · Watch out for: {hack.commonFailure}</>}</div>}
                              </>
                            )) : <div className="r2-empty">No pro tip for this card yet.</div>}
                          </div>
                        )}
                        {activeIcon === 'math' && (
                          <div className="r2-panel-math">
                            {comboHero && combo ? (() => {
                              const assignedCats = new Set(combo.assignments[activeCard.cardId] ?? []);
                              type SpCat = keyof typeof monthlySpend;
                              const spendCats = (Object.keys(monthlySpend) as SpCat[]).filter(cat => (monthlySpend[cat] ?? 0) > 0);
                              const assignedRows = spendCats.filter(cat => assignedCats.has(cat))
                                .map(cat => ({ cat, ce: activeCard.earn.perCategory[cat], spend: monthlySpend[cat as keyof typeof monthlySpend] ?? 0, annual: (activeCard.earn.perCategory[cat]?.guaranteed ?? 0) * 12 }))
                                .filter(r => r.ce != null).sort((a, b) => b.annual - a.annual);
                              const excludedRows = spendCats.filter(cat => !assignedCats.has(cat));
                              const cardNet = cardContrib(activeCard);
                              const maxAnnual = Math.max(1, ...assignedRows.map(r => r.annual));
                              return (
                                <>
                                  <div className="r2-math-hero"><span className="r2-math-hero-lbl">Your value from this card</span><span className="r2-math-hero-val">{inr(cardNet)}<span className="r2-math-hero-yr">/yr</span></span></div>
                                  <div className="r2-math-rows">{assignedRows.map(({ cat, ce, spend, annual }) => (<R2CategoryRow key={cat} cat={cat} ce={ce} monthlySpend={spend} annual={annual} maxAnnual={maxAnnual} />))}{excludedRows.map(cat => (<div key={cat} className="r2-math-row excluded"><span className="r2-math-row-cat">{cat}<span className="r2-math-attributed"> → your other card</span></span><span className="r2-math-row-val excluded">—</span></div>))}</div>
                                  <div className="r2-math-total"><span>Value from assigned categories</span><span className="r2-math-total-val">{inr(cardNet)}</span></div>
                                  {(() => { const fee = activeCard.effectiveAnnualFee; const rawFee = (activeCard.meta as CardMeta).annualFee ?? 0; const waiverSpend = (activeCard.meta as CardMeta).feeWaiverSpend ?? 0; return (<><div className="r2-math-feeline"><div className="r2-math-fee-label">{fee === 0 && rawFee > 0 ? (<><span className="r2-math-fee-strike">{inr(rawFee)}</span><span className="r2-math-fee-waived">waived (exceed {inr(waiverSpend)} routed spend)</span></>) : fee === 0 ? <span className="r2-math-fee-waived">Lifetime Free — no annual fee</span> : <span>Annual fee</span>}</div><span className="r2-math-fee-val">{fee === 0 ? '−₹0' : '−' + inr(fee)}</span></div><div className="r2-math-cardnet"><span>Net from this card</span><span className="r2-math-cardnet-val">{inr(cardNet - fee)}</span></div></>); })()}
                                  {activeCard.annualUpside > 0 && <div className="r2-math-upside">+ up to {inr(activeCard.annualUpside)}/yr extra via the card&rsquo;s portal/app&nbsp;<span className="r2-math-upside-tag">conditional</span></div>}
                                </>
                              );
                            })() : (
                              <><div className="r2-math-hero"><span className="r2-math-hero-lbl">Your value</span><span className="r2-math-hero-val">{inr(activeCard.netGuaranteedPerYear)}<span className="r2-math-hero-yr">/yr</span></span></div>
                              <CardMathBreakdown earn={activeCard.earn} effectiveAnnualFee={activeCard.effectiveAnnualFee} annualFee={(activeCard.meta as CardMeta).annualFee ?? 0} feeWaiverSpend={(activeCard.meta as CardMeta).feeWaiverSpend ?? 0} netGuaranteedPerYear={activeCard.netGuaranteedPerYear} annualUpside={activeCard.annualUpside} monthlySpend={monthlySpend} /></>
                            )}
                          </div>
                        )}
                        {activeIcon === 'priorities' && (
                          <div className="r2-panel-priorities">
                            {comboHero && <div className="r2-pri-context">Showing <b>{activeCard.meta.name}</b>&rsquo;s coverage — swap cards to compare</div>}
                            {priorityKeys.length === 0 ? <div className="r2-empty">You didn&rsquo;t set any priorities.</div> : priorityKeys.map(key => {
                              const ev = evalPriorityForCard(key, activeCard, monthlySpend);
                              const displayLine = priLine(key, activeCard, monthlySpend);
                              return (
                                <div key={key} className={'r2-pri-row ' + ev.status}>
                                  <span className="r2-pri-glyph">{ev.status === 'met' ? '✓' : ev.status === 'partial' ? '⚠' : '✗'}</span>
                                  <div>
                                    <div className="r2-pri-label">{LABEL[key]}</div>
                                    {displayLine && <div className="r2-pri-line">{displayLine}</div>}
                                  </div>
                                </div>
                              );
                            })}
                            {/* Bridge line: type-aware explanation when top priority is unmet */}
                            {!comboHero && !altForTop && priorities?.top && (() => {
                              const topKey = priorities.top;
                              const topEv = evalPriorityForCard(topKey, activeCard, monthlySpend);
                              if (topEv.status === 'met') return null;

                              // Ranked pool: all evaluated cards, best-net-first (excludes the recommended card itself)
                              const rankedPool = (result.ranked ?? []).filter(
                                c => c.cardId !== activeCard.cardId && c.netGuaranteedPerYear > 0
                              );
                              const premium = result.premiumWorthConsidering ?? [];

                              const CATEGORY_KEYS = new Set<PriorityKey>(['Travel', 'Dining', 'Fuel', 'Online']);
                              const REWARD_KEYS   = new Set<PriorityKey>(['Cashback', 'Rewards', 'Forex', 'Movies']);

                              let msg: React.ReactNode;

                              if (CATEGORY_KEYS.has(topKey)) {
                                // Type 1 — Category priority: name the best card for that category
                                const catKey = topKey === 'Online' ? 'Online' : topKey === 'Dining' ? 'Dining' : topKey === 'Fuel' ? 'Fuel' : 'Travel';
                                const bestCard = rankedPool
                                  .map(c => ({ c, earn: (c.earn.perCategory[catKey as keyof typeof c.earn.perCategory]?.guaranteed ?? 0) * 12 }))
                                  .filter(x => x.earn > 0)
                                  .sort((a, b) => b.earn - a.earn)[0];
                                if (bestCard) {
                                  msg = <>Your top priority is <b>{PRIORITY_LABEL[topKey]}</b>, but this card earns nothing on it. <b>{bestCard.c.meta.name}</b> earns the most on {PRIORITY_LABEL[topKey]} — worth considering if {PRIORITY_LABEL[topKey]} matters most to you.</>;
                                } else {
                                  msg = <>Your top priority is <b>{PRIORITY_LABEL[topKey]}</b>, but none of the cards we checked earn much on it.</>;
                                }

                              } else if (topKey === 'Lounge') {
                                // Type 2 — Perk priority: fee-bucket routing
                                const premiumCovers = premium.filter(c => evalPriorityForCard(topKey, c, monthlySpend).status === 'met');
                                const allCandidates = [...rankedPool, ...premium];
                                const coversIt = allCandidates.filter(c => evalPriorityForCard(topKey, c, monthlySpend).status === 'met');
                                if (premiumCovers.some(c => c.netGuaranteedPerYear > 0)) {
                                  msg = <>Your top priority — <b>{PRIORITY_LABEL[topKey]}</b> — isn&rsquo;t covered by cards within your fee budget. Cards that offer it are under &lsquo;Other cards outside your fee preference&rsquo; below. Raise your fee limit to include them.</>;
                                } else if (coversIt.length > 0 && coversIt.every(c => c.netGuaranteedPerYear <= 0)) {
                                  msg = <>Your top priority — <b>{PRIORITY_LABEL[topKey]}</b> — is only offered by cards that wouldn&rsquo;t earn you enough to be worth it on your spending.</>;
                                } else {
                                  msg = <>None of the cards we checked cover your top priority — <b>{PRIORITY_LABEL[topKey]}</b>.</>;
                                }

                              } else if (REWARD_KEYS.has(topKey)) {
                                // Type 3 — Reward-type priority: explain the mismatch, name a card that does cover it
                                const evalLine = topEv.line;
                                const altCard = rankedPool.find(c => evalPriorityForCard(topKey, c, monthlySpend).status === 'met');
                                msg = (
                                  <>
                                    Your top priority is <b>{PRIORITY_LABEL[topKey]}</b>, but this card doesn&rsquo;t give you that.
                                    {evalLine ? <> {evalLine}.</> : null}
                                    {altCard ? <> <b>{altCard.meta.name}</b> does — consider it if this matters most.</> : null}
                                  </>
                                );

                              } else {
                                // Fallback
                                msg = <>Your top priority — <b>{PRIORITY_LABEL[topKey]}</b> — isn&rsquo;t met by this card.</>;
                              }

                              return <div className="r2-pri-bridge">{msg}</div>;
                            })()}
                            {!comboHero && altForTop && (
                              <div className="r2-alt-card">
                                <div className="r2-alt-pill">Alternative for your {PRIORITY_LABEL[altForTop.key]} priority</div>
                                <div className="r2-alt-line">Your optimal setup earns <b>{inr(altForTop.optimalNet)}</b>. The closest setup that covers <b>{PRIORITY_LABEL[altForTop.key]}</b> is <b>{altForTop.card.meta.name}</b>, earning {inr(altForTop.altNet)} — that&rsquo;s <b>{inr(altForTop.costOfSwitch)} less</b>. Your call.</div>
                                <button className="r2-alt-toggle" onClick={() => setAltExpanded(v => !v)}>{altExpanded ? 'Hide details ↑' : 'See full details →'}</button>
                                {altExpanded && <div className="r2-alt-detail"><RecommendationCard card={altForTop.card} monthlySpend={monthlySpend} forexPct={(altForTop.card.meta as CardMeta).forexPct} isTravelPriority={isTravelPriority} devaluation={devaluations?.[altForTop.card.cardId]} hack={hacks?.[altForTop.card.cardId] ?? undefined} intelligence={intelligence?.[altForTop.card.cardId]} narrative={narratives?.[altForTop.card.cardId]} onKnowMore={onKnowMore ? () => onKnowMore(altForTop.card.cardId) : undefined} /></div>}
                              </div>
                            )}
                          </div>
                        )}
                        {activeIcon === 'know' && <KnowPanel intel={intel} />}
                      </div>
                    )}
                  </>
                );
              })()}

              {/* Transfer callout (Journey B) */}
              {(() => {
                const activeCard = comboHero && front ? front : top;
                if (!activeCard) return null;
                const th = transferHacks?.[activeCard.cardId];
                if (!th || !th.displayTravelHack) return null;
                const partners = transferPartners?.[activeCard.cardId] ?? [];
                return <TransferCallout hack={th} partners={partners} cardName={activeCard.meta.name} />;
              })()}

              {/* Lower tabs (Journey B) */}
              {(() => {
                const t = result.transparency;
                const eligibleCount = t.totalEvaluated - t.failedIncome - t.failedFee;
                const premium = result.premiumWorthConsidering ?? [];
                const runners = result.runnersUp ?? [];
                const TAB_LABELS: Record<TabKey, string> = { fee: 'Other cards outside your fee preference', others: 'Also considered', how: 'How we picked' };
                return (
                  <>
                    <div className="r2-lowtabrow">
                      {(['fee', 'others', 'how'] as TabKey[]).map(key => (
                        <button key={key} className={'r2-lowtabbtn' + (activeTab === key ? ' on' : '')} onClick={() => toggleTab(key)}>{TAB_LABELS[key]}</button>
                      ))}
                    </div>
                    {activeTab && (
                      <div className="r2-lowcontent">
                        {activeTab === 'fee' && (premium.length === 0 ? <div className="r2-lc-note">No cards above your fee preference have significantly stronger value for your spend.{result.premiumWorthConsidering === undefined ? ' (This section is most relevant when you have a Travel or Lounge priority.)' : ''}</div> : <>{premium.map(c => (<div key={c.cardId} className="r2-lc-item"><span className="r2-lc-name">{c.meta.name}</span><span className="r2-lc-val">{(c.meta as CardMeta).annualFee ? `₹${(c.meta as CardMeta).annualFee!.toLocaleString('en-IN')} fee` : 'Lifetime Free'}</span></div>))}<div className="r2-lc-note">Above your fee comfort, but strong value if you&rsquo;d stretch.</div></>)}
                        {activeTab === 'others' && (runners.length === 0 ? <div className="r2-lc-note">No other cards to show.</div> : runners.map(c => (<div key={c.cardId} className="r2-lc-item"><span className="r2-lc-name">{c.meta.name}{c.inviteOnly && <span className="r2-lc-badge">invite</span>}</span><span className="r2-lc-val">{inr(c.netGuaranteedPerYear)}/yr</span></div>)))}
                        {activeTab === 'how' && (<><div className="r2-elig yes"><span className="r2-elig-n">✓{eligibleCount}</span><span className="r2-elig-t">eligible for you</span></div>{t.failedIncome > 0 && <div className="r2-elig no"><span className="r2-elig-n">✕{t.failedIncome}</span><span className="r2-elig-t">income mismatch</span></div>}{t.failedFee > 0 && <div className="r2-elig no"><span className="r2-elig-n">✕{t.failedFee}</span><span className="r2-elig-t">above your fee comfort</span></div>}{t.inviteOnly > 0 && <div className="r2-elig no"><span className="r2-elig-n">✕{t.inviteOnly}</span><span className="r2-elig-t">invite-only</span></div>}{t.weakSpendMatch > 0 && <div className="r2-elig no"><span className="r2-elig-n">✕{t.weakSpendMatch}</span><span className="r2-elig-t">weak fit for your spend</span></div>}<div className="r2-lc-note" style={{ marginTop: 14 }}>Ranked by net annual rupee value for your exact spends. No card pays to rank here.</div></>)}
                      </div>
                    )}
                  </>
                );
              })()}

              {result.creditNote && <div className="r2-creditnote">{result.creditNote}</div>}

              {(onBack || onRestart) && (
                <div className="r2-nav">
                  {onBack && <button className="r2-back" onClick={onBack}>Back</button>}
                  {onRestart && <button className="r2-restart" onClick={onRestart}>Start over</button>}
                </div>
              )}
            </>
          )}

          {/* Credit note — Journey A */}
          {journeyA && result.creditNote && <div className="r2-creditnote">{result.creditNote}</div>}
        </div>

        {/* ── Phase 2: full-width grid child (Journey A only) ── */}
        {journeyA && phase2Open && top && (() => {
          const activeCard = top;
          const cardId = activeCard.cardId;
          const hack = hacks?.[cardId] ?? null;
          const intel = intelligence?.[cardId] ?? [];
          const narrative = narratives?.[cardId];
          const activeIconCfg = ICONS.find(i => i.key === activeIcon);
          const priorityKeys: PriorityKey[] = [
            ...(priorities?.top ? [priorities.top] : []),
            ...(priorities?.secondary ? [priorities.secondary] : []),
            ...(priorities?.niceToHave ? [priorities.niceToHave] : []),
          ];
          const cardCats = Object.entries(activeCard.earn.perCategory)
            .filter(([, v]) => v.guaranteed > 0)
            .sort(([, a], [, b]) => b.guaranteed - a.guaranteed)
            .slice(0, 3).map(([c]) => c).join(' · ');

          return (
            <div className="r2-phase2">
              {/* Phase 2 inner sub-grid: left = hero + why-tag + card tile; right = combined map + icon row + detail panel */}
              <div className="r2-phase2-grid">
                {/* Left cell: card tile first, then eyebrow, hero, why-tag */}
                <div className="r2-phase2-left">
                  {/* Recommendation card tile — leads the section */}
                  <div className="r2-solo-stack">
                    <PCard
                      card={top}
                      cats={Object.entries(top.earn.perCategory)
                        .filter(([, v]) => v.guaranteed > 0)
                        .sort(([, a], [, b]) => b.guaranteed - a.guaranteed)
                        .slice(0, 4).map(([cat]) => cat).join(' · ')}
                      net={top.netGuaranteedPerYear}
                      hideNet
                      className="r2-pcard-solo"
                    />
                  </div>

                  <div className="r2-eyebrow r2-phase2-eyebrow">Top addition for your setup</div>
                  {top.marginalGainPerYear != null && (
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
                      {/* "Why this recommendation" tag */}
                      {(() => {
                        if (!top.marginalPerCategory) return null;
                        const entries = Object.entries(top.marginalPerCategory)
                          .filter(([, d]) => d.incrementalGuaranteed > 0)
                          .sort(([, a], [, b]) => b.incrementalGuaranteed - a.incrementalGuaranteed);
                        if (entries.length === 0) return null;
                        const totalIncremental = entries.reduce((s, [, d]) => s + d.incrementalGuaranteed, 0);
                        const [topCat, topDelta] = entries[0];
                        const topCatLabel = CATEGORY_LABELS[topCat as keyof typeof CATEGORY_LABELS] ?? topCat;
                        if (topDelta.currentBestGuaranteed === 0 &&
                            topDelta.incrementalGuaranteed / totalIncremental >= 0.40) {
                          return (
                            <div className="r2-gaptag r2-gaptag--gap">
                              <span className="r2-gaptag-pill">{topCatLabel}</span>
                              <span className="r2-gaptag-text">
                                None of your cards earn on <b>{topCatLabel}</b>. Adding this card fills that gap.
                              </span>
                            </div>
                          );
                        }
                        const catNames = entries.map(([cat]) => CATEGORY_LABELS[cat as keyof typeof CATEGORY_LABELS] ?? cat);
                        const MAX_SHOW = 2;
                        const pillLabel = catNames.length <= MAX_SHOW
                          ? catNames.join(' & ')
                          : catNames.slice(0, MAX_SHOW).join(', ') + ` & ${catNames.length - MAX_SHOW} more`;
                        const proseLabel = catNames.length === 1
                          ? catNames[0]
                          : catNames.slice(0, -1).join(', ') + ' & ' + catNames[catNames.length - 1];
                        return (
                          <div className="r2-gaptag r2-gaptag--beat">
                            <span className="r2-gaptag-text">
                              Earns more than your current cards on <b>{proseLabel}</b>.
                            </span>
                          </div>
                        );
                      })()}
                    </>
                  )}

                </div>{/* /r2-phase2-left */}

                {/* Right cell: combined per-category verdict map, icon row, detail panel */}
                <div className="r2-phase2-right">
                  {result.bestCardPerCategory && top.marginalPerCategory && (() => {
                    const cats = Object.keys(monthlySpend).filter(c => (monthlySpend[c as keyof typeof monthlySpend] ?? 0) > 0);
                    type CombinedRow = {
                      cat: string;
                      winnerName: string;
                      winnerCardId: string | null;
                      guaranteed: number; // ₹/month
                      isRec: boolean;     // true = recommended card wins
                      isLeak: boolean;
                    };
                    const rows: CombinedRow[] = cats.map(cat => {
                      const owned = result.bestCardPerCategory![cat];
                      const ownedGuaranteed = owned?.guaranteed ?? 0;
                      const recGuaranteed = top.earn.perCategory[cat]?.guaranteed ?? 0;
                      const isLeak = ownedGuaranteed === 0 && recGuaranteed === 0;
                      const recWins = recGuaranteed > ownedGuaranteed;
                      return {
                        cat,
                        winnerName: recWins ? top.meta.name : (owned?.cardName ?? '—'),
                        winnerCardId: recWins ? top.cardId : (owned?.cardId ?? null),
                        guaranteed: Math.max(ownedGuaranteed, recGuaranteed),
                        isRec: recWins,
                        isLeak,
                      };
                    });
                    const sorted = rows.slice().sort((a, b) => {
                      if (a.isLeak !== b.isLeak) return a.isLeak ? 1 : -1;
                      return b.guaranteed - a.guaranteed;
                    });
                    const combinedGrossAnnual = rows.reduce((s, r) => s + r.guaranteed * 12, 0);
                    const phase1GrossAnnual = Object.values(result.bestCardPerCategory).reduce((s, r) => s + (r.guaranteed ?? 0) * 12, 0);
                    const addedAnnual = combinedGrossAnnual - phase1GrossAnnual;
                    // Net current value: sum of per-card net contributions (= setup.value from engine)
                    const currentNet = (result.ownedVerdicts ?? []).reduce((s, v) => s + v.netPerYear, 0);
                    // Net total: current + gain (both net of all fees, reconciles exactly)
                    const netTotal = top.marginalGainPerYear != null
                      ? currentNet + top.marginalGainPerYear
                      : null;
                    return (
                      <div className="r2-routemap r2-combined-map">
                        <div className="r2-routemap-heading-row">
                          <span className="r2-eyebrow r2-routemap-heading">With {top.meta.name} added</span>
                          <span className="r2-routemap-sub">best card per category</span>
                        </div>
                        {sorted.map(({ cat, winnerName, guaranteed, isRec, isLeak }) => (
                          <div key={cat} className={'r2-routemap-row' + (isLeak ? ' leak' : '') + (isRec ? ' rec-wins' : '')}>
                            <span className="r2-routemap-cat">{cat}</span>
                            {isLeak ? (
                              <span className="r2-routemap-leak-note">none earn here</span>
                            ) : (
                              <>
                                <span className="r2-routemap-card">
                                  {winnerName}
                                  {isRec && <span className="r2-combined-new">new</span>}
                                </span>
                                <span className="r2-routemap-val">₹{Math.round(guaranteed * 12).toLocaleString('en-IN')}/yr</span>
                              </>
                            )}
                          </div>
                        ))}
                        {/* Plain-language scenario box — before→after story */}
                        {netTotal != null && top.marginalGainPerYear != null && (() => {
                          const recCats = sorted.filter(r => r.isRec && !r.isLeak).map(r => r.cat);
                          const ownedCats = sorted.filter(r => !r.isRec && !r.isLeak).map(r => r.cat);
                          const isOverpower = ownedCats.length === 0;
                          const joinCats = (cats: string[]) =>
                            cats.length <= 2
                              ? cats.join(' & ')
                              : cats.slice(0, -1).join(', ') + ' & ' + cats[cats.length - 1];
                          return (
                            <div className="r2-scenario-box">
                              {isOverpower ? (
                                <span>
                                  Adding <b>{top.meta.name}</b> would cover nearly all your spending.
                                  You&rsquo;d earn about <b>{inr(netTotal)}/yr</b> in total —{' '}
                                  <b>{inr(top.marginalGainPerYear)}/yr more than today</b>, after all fees.
                                </span>
                              ) : (
                                <span>
                                  Your current cards keep earning on <b>{joinCats(ownedCats)}</b>.{' '}
                                  <b>{top.meta.name}</b> adds value on <b>{joinCats(recCats)}</b>.{' '}
                                  Together you&rsquo;d earn about <b>{inr(netTotal)}/yr</b> —{' '}
                                  <b>{inr(top.marginalGainPerYear)}/yr more than today</b>, after all fees.
                                </span>
                              )}
                              {/* Line 1 — priorities match summary */}
                              {priorityKeys.length > 0 && (() => {
                                const matched = priorityKeys.filter(k => evalPriorityForCard(k, top, monthlySpend).status === 'met');
                                const matchedNames = matched.map(k => PRIORITY_LABEL[k]).join(', ');
                                return (
                                  <div className="r2-scenario-meta">
                                    {matched.length > 0
                                      ? <>Matches <b>{matched.length}</b> of your {priorityKeys.length} {priorityKeys.length === 1 ? 'priority' : 'priorities'} — {matchedNames}. <span className="r2-scenario-tab-hint">Tap the Priorities icon below for details.</span></>
                                      : <>It doesn&rsquo;t match any of your {priorityKeys.length} {priorityKeys.length === 1 ? 'priority' : 'priorities'}. <span className="r2-scenario-tab-hint">Tap the Priorities icon below for details.</span></>
                                    }
                                  </div>
                                );
                              })()}
                              {/* Line 2 — excluded categories the user spends in */}
                              {(() => {
                                const excCats = (Object.keys(monthlySpend) as Array<keyof typeof monthlySpend>)
                                  .filter(cat => top.earn.perCategory[cat]?.excluded === true && (monthlySpend[cat] ?? 0) > 0);
                                if (excCats.length === 0) return null;
                                const excAnnual = excCats.reduce((s, cat) => s + (monthlySpend[cat] ?? 0) * 12, 0);
                                const excNames = excCats.map(cat => (CATEGORY_LABELS as Record<string, string>)[cat] ?? cat).join(', ');
                                return (
                                  <div className="r2-scenario-meta r2-scenario-excl">
                                    Pays nothing on <b>{excNames}</b>, where you spend <b>{inr(excAnnual)}/yr</b> — keep another card for that.
                                  </div>
                                );
                              })()}
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })()}

                  {/* Icon row */}
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
                        <div className="r2-circ"><Icon size={20} strokeWidth={1.75} /></div>
                        <span className="r2-lbl">{label}</span>
                      </button>
                    ))}
                  </div>

                  {/* Detail panel */}
                  {activeIcon && activeIconCfg && (
                    <div className="r2-detail" style={{ '--r2-accent': activeIconCfg.accent } as React.CSSProperties}>
                      <div className="r2-detail-which">
                        {activeCard.meta.name}{cardCats ? ` · ${cardCats}` : ''}
                      </div>

                      {activeIcon === 'pros' && (
                        <div className="r2-panel-pros">
                          {narrative ? (
                            <>
                              {narrative.topPros.length > 0 && (
                                <div className="r2-procon-group">
                                  {narrative.topPros.map((p, i) => (
                                    <div key={i} className="r2-item"><span className="r2-pl">+</span><span>{p.text}</span></div>
                                  ))}
                                </div>
                              )}
                              {narrative.topCons.length > 0 && (
                                <div className="r2-procon-group" style={{ marginTop: narrative.topPros.length > 0 ? '10px' : 0 }}>
                                  {narrative.topCons.map((c, i) => (
                                    <div key={i} className="r2-item"><span className="r2-mn">−</span><span>{c.text}</span></div>
                                  ))}
                                </div>
                              )}
                              {onKnowMore && (
                                <button className="r2-linkbtn" onClick={() => onKnowMore(cardId)}>See full pros &amp; cons →</button>
                              )}
                            </>
                          ) : <div className="r2-empty">No pros/cons data available.</div>}
                        </div>
                      )}

                      {activeIcon === 'hack' && (
                        <div className="r2-panel-hack">
                          {hack ? (hack.locked ? (
                            <div className="r2-hackbox locked">
                              <div className="r2-ht">{hack.name}</div>
                              <div className="r2-hd">Unlocks at <b>₹{hack.locked.minMonthlySpend.toLocaleString('en-IN')}/month</b>. You&rsquo;re <b>₹{hack.locked.gap.toLocaleString('en-IN')}/month</b> away.</div>
                            </div>
                          ) : (
                            <>
                              <div className="r2-hackbox"><div className="r2-ht">{hack.name}</div><div className="r2-hd">{hack.whyItMatters}</div></div>
                              {hack.executionSteps && (
                                <>
                                  <button className="r2-hack-seehow" onClick={() => setHackStepsOpen(v => !v)}>
                                    {hackStepsOpen ? 'Hide steps ↑' : 'See how →'}
                                  </button>
                                  {hackStepsOpen && <HackSteps steps={hack.executionSteps} />}
                                </>
                              )}
                              {hack.difficulty && (
                                <div className="r2-hack-meta">Effort: <b>{difficultyLabel(hack.difficulty)}</b>{hack.commonFailure && <> · Watch out for: {hack.commonFailure}</>}</div>
                              )}
                            </>
                          )) : <div className="r2-empty">No pro tip for this card yet.</div>}
                        </div>
                      )}

                      {activeIcon === 'math' && (
                        <div className="r2-panel-math">
                          {(() => {
                            const margCat = top.marginalPerCategory ?? {};
                            const fee = activeCard.effectiveAnnualFee;
                            const annualFee = (activeCard.meta as CardMeta).annualFee ?? 0;
                            const feeWaiverSpend = (activeCard.meta as CardMeta).feeWaiverSpend ?? 0;
                            const rows = (Object.keys(activeCard.earn.perCategory) as Array<keyof typeof activeCard.earn.perCategory>)
                              .map(cat => ({
                                cat,
                                annual: (activeCard.earn.perCategory[cat]?.guaranteed ?? 0) * 12,
                                incremental: margCat[cat]?.incrementalGuaranteed ?? 0,
                                spend: monthlySpend[cat as keyof typeof monthlySpend] ?? 0,
                              }))
                              .filter(r => r.spend > 0)
                              .sort((a, b) => b.annual - a.annual);
                            const maxAnnual = Math.max(1, ...rows.map(r => r.annual));
                            const hasMarginal = rows.some(r => r.incremental > 0);
                            return (
                              <>
                                <div className="r2-math-hero">
                                  <span className="r2-math-hero-lbl">Standalone value</span>
                                  <span className="r2-math-hero-val">{inr(activeCard.netGuaranteedPerYear)}<span className="r2-math-hero-yr">/yr</span></span>
                                </div>

                                {hasMarginal && (
                                  <div className="r2-math-legend">
                                    <span className="r2-math-legend-dot r2-math-legend-dot--new" />
                                    <span>New value over your existing cards</span>
                                    <span className="r2-math-legend-dot r2-math-legend-dot--covered" />
                                    <span>Already covered by your cards</span>
                                  </div>
                                )}

                                <div className="r2-math-rows">
                                  {rows.map(r => {
                                    const isMarginal = r.incremental > 0;
                                    const barPct = Math.round((r.annual / maxAnnual) * 100);
                                    return (
                                      <div key={r.cat} className={'r2-math-row' + (isMarginal ? ' r2-math-row--new' : ' r2-math-row--covered')}>
                                        <div className="r2-math-row-top">
                                          <span className="r2-math-row-cat">
                                            {r.cat}
                                            {isMarginal && <span className="r2-math-row-pill">new</span>}
                                          </span>
                                          <span className="r2-math-row-val">{inr(r.annual)}/yr</span>
                                        </div>
                                        <div className="r2-math-bar-track">
                                          <div className="r2-math-bar-fill" style={{ width: `${barPct}%`, background: isMarginal ? '#10b981' : '#3f3f46' }} />
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>

                                {/* Fee line */}
                                <div className="r2-math-feeline">
                                  <span className="r2-math-feeline-lbl">
                                    {fee === 0 && annualFee > 0
                                      ? <><span className="r2-math-strike">{inr(annualFee)}</span> <span className="r2-math-waived">waived (you exceed {inr(feeWaiverSpend)}/yr)</span></>
                                      : fee === 0 ? <span className="r2-math-waived">Lifetime free — no annual fee</span>
                                      : 'Annual fee'}
                                  </span>
                                  <span className="r2-math-feeline-val">{fee === 0 ? '−₹0' : `−${inr(fee)}`}</span>
                                </div>

                                {/* Standalone net */}
                                <div className="r2-math-net">
                                  <span>Standalone net</span>
                                  <span className="r2-math-net-val">{inr(activeCard.netGuaranteedPerYear)}/yr</span>
                                </div>

                                {activeCard.annualUpside > 0 && (
                                  <div className="r2-math-upside">
                                    + up to {inr(activeCard.annualUpside)}/yr extra via card portal/app <span className="r2-math-upside-tag">conditional</span>
                                  </div>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      )}

                      {activeIcon === 'priorities' && (
                        <div className="r2-panel-priorities">
                          {priorityKeys.length === 0 ? (
                            <div className="r2-empty">You didn&rsquo;t set any priorities.</div>
                          ) : priorityKeys.map(key => {
                            const ev = evalPriorityForCard(key, activeCard, monthlySpend);
                            const displayLine = priLine(key, activeCard, monthlySpend);
                            return (
                              <div key={key} className={'r2-pri-row ' + ev.status}>
                                <span className="r2-pri-glyph">{ev.status === 'met' ? '✓' : ev.status === 'partial' ? '⚠' : '✗'}</span>
                                <div>
                                  <div className="r2-pri-label">{LABEL[key]}</div>
                                  {displayLine && <div className="r2-pri-line">{displayLine}</div>}
                                </div>
                              </div>
                            );
                          })}
                          {altForTop && (
                            <div className="r2-alt-card">
                              <div className="r2-alt-pill">Alternative for your {PRIORITY_LABEL[altForTop.key]} priority</div>
                              <div className="r2-alt-line">
                                Your optimal setup earns <b>{inr(altForTop.optimalNet)}</b>. The closest setup that covers <b>{PRIORITY_LABEL[altForTop.key]}</b> is <b>{altForTop.card.meta.name}</b>, earning {inr(altForTop.altNet)} — that&rsquo;s <b>{inr(altForTop.costOfSwitch)} less</b>. Your call.
                              </div>
                              <button className="r2-alt-toggle" onClick={() => setAltExpanded(v => !v)}>
                                {altExpanded ? 'Hide details ↑' : 'See full details →'}
                              </button>
                              {altExpanded && (
                                <div className="r2-alt-detail">
                                  <RecommendationCard
                                    card={altForTop.card} monthlySpend={monthlySpend}
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

                      {activeIcon === 'know' && <KnowPanel intel={intel} />}
                    </div>
                  )}
                </div>{/* /r2-phase2-right */}
              </div>{/* /r2-phase2-grid */}

              {/* Transfer callout for the recommendation card */}
              {(() => {
                const th = transferHacks?.[cardId];
                if (!th || !th.displayTravelHack) return null;
                const partners = transferPartners?.[cardId] ?? [];
                return <TransferCallout hack={th} partners={partners} cardName={activeCard.meta.name} />;
              })()}

              {/* Lower tabs */}
              {(() => {
                const t = result.transparency;
                const eligibleCount = t.totalEvaluated - t.failedIncome - t.failedFee;
                const premium = result.premiumWorthConsidering ?? [];
                const runners = result.runnersUp ?? [];
                const TAB_LABELS: Record<TabKey, string> = {
                  fee: 'Other cards outside your fee preference',
                  others: 'Also considered', how: 'How we picked',
                };
                return (
                  <>
                    <div className="r2-lowtabrow">
                      {(['fee', 'others', 'how'] as TabKey[]).map(key => (
                        <button key={key} className={'r2-lowtabbtn' + (activeTab === key ? ' on' : '')} onClick={() => toggleTab(key)}>
                          {TAB_LABELS[key]}
                        </button>
                      ))}
                    </div>
                    {activeTab && (
                      <div className="r2-lowcontent">
                        {activeTab === 'fee' && (premium.length === 0 ? (
                          <div className="r2-lc-note">No cards above your fee preference have significantly stronger value.{result.premiumWorthConsidering === undefined ? ' (Most relevant for Travel or Lounge priority.)' : ''}</div>
                        ) : (
                          <>{premium.map(c => (<div key={c.cardId} className="r2-lc-item"><span className="r2-lc-name">{c.meta.name}</span><span className="r2-lc-val">{(c.meta as CardMeta).annualFee ? `₹${(c.meta as CardMeta).annualFee!.toLocaleString('en-IN')} fee` : 'Lifetime Free'}</span></div>))}<div className="r2-lc-note">Above your fee comfort, but strong value if you&rsquo;d stretch.</div></>
                        ))}
                        {activeTab === 'others' && (runners.length === 0 ? <div className="r2-lc-note">No other cards to show.</div> :
                          runners.map(c => (<div key={c.cardId} className="r2-lc-item"><span className="r2-lc-name">{c.meta.name}{c.inviteOnly && <span className="r2-lc-badge">invite</span>}</span><span className="r2-lc-val">+{inr(c.marginalGainPerYear ?? 0)}/yr additional</span></div>))
                        )}
                        {activeTab === 'how' && (
                          <>
                            <div className="r2-elig yes"><span className="r2-elig-n">✓{eligibleCount}</span><span className="r2-elig-t">eligible for you</span></div>
                            {t.failedIncome > 0 && <div className="r2-elig no"><span className="r2-elig-n">✕{t.failedIncome}</span><span className="r2-elig-t">income mismatch</span></div>}
                            {t.failedFee > 0 && <div className="r2-elig no"><span className="r2-elig-n">✕{t.failedFee}</span><span className="r2-elig-t">above your fee comfort</span></div>}
                            {t.inviteOnly > 0 && <div className="r2-elig no"><span className="r2-elig-n">✕{t.inviteOnly}</span><span className="r2-elig-t">invite-only</span></div>}
                            {t.weakSpendMatch > 0 && <div className="r2-elig no"><span className="r2-elig-n">✕{t.weakSpendMatch}</span><span className="r2-elig-t">weak fit for your spend</span></div>}
                            <div className="r2-lc-note" style={{ marginTop: 14 }}>Ranked by net annual rupee value for your exact spends. No card pays to rank here.</div>
                          </>
                        )}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          );
        })()}

        {/* Back / Start over — bottom of page, Journey A only */}
        {journeyA && (onBack || onRestart) && (
          <div className="r2-nav r2-nav--bottom">
            {onBack && <button className="r2-back" onClick={onBack}>Back</button>}
            {onRestart && <button className="r2-restart" onClick={onRestart}>Start over</button>}
          </div>
        )}

      </div>

    </div>
  );
};

const css = `
/* ── Shell & grid — matches prototype .shell ── */
.r2-shell{font-family:'DM Sans',system-ui,sans-serif;color:#fafafa;max-width:1080px;margin:0 auto}
.r2-grid{position:relative;z-index:1;display:grid;grid-template-columns:380px 1fr;gap:32px;align-items:start}
@media(max-width:820px){.r2-grid{grid-template-columns:1fr}}

/* ── Stage 5: decorative background layer — fixed, behind all content, non-interactive ── */
.r2-bg{position:fixed;inset:0;z-index:0;overflow:hidden;pointer-events:none;
  background:
    radial-gradient(48% 52% at 6% 8%, #10b9811f, transparent 70%),
    radial-gradient(52% 56% at 94% 92%, #8b5cf61c, transparent 70%),
    radial-gradient(130% 95% at 50% -8%, #17171d 0%, #0c0c11 48%, #050507 100%)}
.r2-bg-svg{position:absolute;inset:0;width:100%;height:100%}
.r2-bg-lines{opacity:.85;animation:r2-lines-drift 26s ease-in-out infinite alternate}
.r2-floatcirc{position:absolute;border-radius:50%;border:1.5px solid;display:flex;
  align-items:center;justify-content:center;font-size:18px;opacity:.6;will-change:transform}
.r2-floatcirc.fc1{top:15%;left:11%;width:58px;height:58px;animation:r2-drift-a 17s ease-in-out infinite}
.r2-floatcirc.fc2{top:24%;right:13%;width:52px;height:52px;animation:r2-drift-b 21s ease-in-out infinite}
.r2-floatcirc.fc3{top:64%;right:9%;width:54px;height:54px;animation:r2-drift-a 23s ease-in-out infinite}
.r2-floatcirc.fc4{bottom:13%;left:16%;width:50px;height:50px;animation:r2-drift-b 19s ease-in-out infinite}
@keyframes r2-drift-a{
  0%{transform:translate(0,0);opacity:.5}
  50%{transform:translate(16px,-20px);opacity:.68}
  100%{transform:translate(0,0);opacity:.5}}
@keyframes r2-drift-b{
  0%{transform:translate(0,0);opacity:.48}
  50%{transform:translate(-18px,16px);opacity:.66}
  100%{transform:translate(0,0);opacity:.48}}
@keyframes r2-lines-drift{
  0%{transform:translateX(0)}
  100%{transform:translateX(-28px)}}
@media(prefers-reduced-motion:reduce){
  .r2-bg-lines,.r2-floatcirc{animation:none}}

/* ── Left column — sticky for Journey B (hero stays visible while scrolling icon panels) ── */
.r2-left{position:sticky;top:24px;z-index:0;isolation:isolate}
/* Journey A: carousel doesn't need to stick — scrolling it off-screen is fine,
   and removing sticky eliminates any chance of it painting over Phase 2 content. */
.r2-left--a{position:static;isolation:auto}
@media(max-width:820px){.r2-left{position:static}}

/* ── Eyebrow + hero numbers — scaled for desktop two-column layout ── */
.r2-eyebrow{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#71717a;margin-bottom:6px}
.r2-hero-num{font-size:32px;font-weight:800;color:#10b981;letter-spacing:-0.02em;line-height:1.05;font-variant-numeric:tabular-nums}
.r2-hero-yr{font-size:20px;font-weight:800;color:#10b981;letter-spacing:-.01em}
.r2-hero-sub{font-size:13px;color:#fafafa;margin-top:5px;margin-bottom:20px;line-height:1.4}
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
.r2-swaphint{font-size:12px;color:#71717a;margin-bottom:10px}
.r2-swaphint b{color:#fafafa;font-weight:600}

/* ── Combo footnote ── */
.r2-footnote{font-size:12.5px;color:#fafafa;line-height:1.55;margin-top:4px}
.r2-footnote b{color:#10b981;font-weight:700;font-variant-numeric:tabular-nums}

/* ── Single-card baseline — matches prototype .betterline ── */
.r2-betterline{margin-top:12px;font-size:15px;color:#fafafa;line-height:1.4}
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
  color:#fafafa;transition:all .18s}
.r2-iconcircle.on .r2-circ{
  border-color:var(--r2-accent,#10b981);
  background-color:color-mix(in srgb,var(--r2-accent,#10b981) 10%,#0c0c0e);
  box-shadow:0 0 0 1px color-mix(in srgb,var(--r2-accent,#10b981) 30%,transparent),
             0 0 14px color-mix(in srgb,var(--r2-accent,#10b981) 18%,transparent);
  color:var(--r2-accent,#10b981)}
.r2-iconcircle:hover:not(.on) .r2-circ{border-color:#3f3f46;color:#fafafa}
.r2-lbl{font-size:10px;font-weight:600;color:#71717a;text-align:center;line-height:1.3}
.r2-iconcircle.on .r2-lbl{color:#d4d4d8}

/* ── Detail panel ── */
.r2-detail{
  background:#0c0c0e;border:1px solid #1f1f23;border-radius:14px;
  padding:18px;margin-bottom:8px;
  border-top-color:color-mix(in srgb,var(--r2-accent,#10b981) 35%,#1f1f23)}
.r2-detail-which{
  font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
  color:#71717a;margin-bottom:14px}

/* ── Shared item rows ── */
.r2-item{display:flex;gap:9px;font-size:13px;color:#d4d4d8;line-height:1.55;margin-bottom:8px}
.r2-pl{color:#10b981;font-weight:800;flex-shrink:0}
.r2-mn{color:#f59e0b;font-weight:800;flex-shrink:0}
.r2-item-val{color:#fafafa;font-size:12px}
.r2-empty{font-size:13px;color:#71717a;line-height:1.5}

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
.r2-hd{color:#fafafa;font-size:13px;line-height:1.55}
.r2-hackbox.locked .r2-ht{color:#71717a}
.r2-steps{margin-top:10px}
.r2-step{display:flex;gap:10px;font-size:13px;color:#d4d4d8;line-height:1.5;margin-bottom:9px}
.r2-sn{
  width:20px;height:20px;border-radius:50%;background:#18181b;color:#8b5cf6;
  font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.r2-hack-meta{font-size:11.5px;color:#71717a;margin-top:4px;line-height:1.5}
.r2-hack-meta b{color:#fafafa}
.r2-hack-seehow{
  background:none;border:none;color:#8b5cf6;font-family:inherit;font-size:13px;
  font-weight:600;cursor:pointer;padding:8px 0 2px;display:block}
.r2-hack-seehow:hover{color:#a78bfa}

/* ── Math panel hero stat ── */
.r2-math-hero{
  display:flex;align-items:baseline;justify-content:space-between;
  margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid #1f1f23}
.r2-math-hero-lbl{font-size:12px;font-weight:600;color:#fafafa}
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
.r2-cat-spend{font-size:11.5px;color:#fafafa;margin:3px 0 5px 16px}
.r2-cat-rate{color:#fafafa}
.r2-bar-track{height:5px;background:#18181b;border-radius:3px;overflow:hidden;margin-left:16px}
.r2-bar{height:100%;border-radius:3px}
.r2-caphit{font-size:11px;color:#f59e0b;margin:5px 0 0 16px;display:flex;flex-wrap:wrap;gap:8px}
.r2-caphit-loss{color:#dc2626;font-weight:600}
.r2-thresh{font-size:11px;color:#10b981;margin:4px 0 0 16px}
/* Excluded (other card's) rows — simple, greyed */
.r2-math-row{
  display:flex;justify-content:space-between;align-items:baseline;
  font-size:13px;padding:7px 0;border-bottom:1px solid #141416}
.r2-math-row.excluded .r2-math-row-cat{color:#71717a}
.r2-math-row-val.excluded{color:#71717a}
.r2-math-attributed{font-size:11px;color:#71717a;font-style:italic}
/* Total line */
.r2-math-total{
  display:flex;justify-content:space-between;align-items:baseline;
  padding:10px 0 0;margin-top:8px;border-top:1px solid #27272a}
.r2-math-total>span:first-child{font-size:13px;font-weight:600;color:#fafafa}
.r2-math-total-val{font-size:20px;font-weight:800;color:#10b981;
  font-variant-numeric:tabular-nums;letter-spacing:-.02em}
/* Upside note (combo) */
.r2-math-upside{
  margin-top:10px;font-size:12px;color:#fafafa;line-height:1.5;
  background:#18140a;border:1px solid #3a2f10;border-radius:9px;padding:9px 11px}
.r2-math-upside-tag{
  display:inline-block;font-size:9px;font-weight:700;text-transform:uppercase;
  color:#f59e0b;border:1px solid #f59e0b;border-radius:4px;
  padding:1px 5px;margin-left:5px;letter-spacing:.05em;vertical-align:middle}

/* ── Combo hero fee note ── */
.r2-combo-feenote{font-size:12px;color:#71717a;margin-top:-12px;margin-bottom:18px;line-height:1.4}
.r2-combo-feenote.waived{color:#10b981}

/* ── Combo Math fee line + net line (mirrors CardMathBreakdown) ── */
.r2-math-feeline{
  display:flex;justify-content:space-between;align-items:baseline;
  padding:8px 0 0;margin-top:6px;border-top:1px solid #1f1f23;font-size:13px}
.r2-math-fee-label{color:#fafafa;display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
.r2-math-fee-strike{text-decoration:line-through;color:#71717a}
.r2-math-fee-waived{color:#10b981;font-weight:600;font-size:12px}
.r2-math-fee-val{color:#fafafa;font-weight:600;font-variant-numeric:tabular-nums;flex-shrink:0}
.r2-math-cardnet{
  display:flex;justify-content:space-between;align-items:baseline;
  padding:8px 0 0;margin-top:4px;border-top:1px solid #27272a}
.r2-math-cardnet>span:first-child{font-size:13px;font-weight:700;color:#fafafa}
.r2-math-cardnet-val{font-size:22px;font-weight:800;color:#10b981;
  font-variant-numeric:tabular-nums;letter-spacing:-.02em}

/* ── Phase 2 Math panel: per-category rows with marginal highlight ── */
.r2-math-legend{display:flex;align-items:center;gap:6px;font-size:11px;color:#fafafa;margin-bottom:12px;flex-wrap:wrap}
.r2-math-legend-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.r2-math-legend-dot--new{background:#10b981}
.r2-math-legend-dot--covered{background:#3f3f46}
/* Override .r2-math-row for Phase 2 per-category rows */
.r2-panel-math .r2-math-row{
  display:block;padding:6px 0 6px 8px;border-bottom:none;border-left:3px solid transparent;
  margin-bottom:6px;border-radius:0 6px 6px 0}
.r2-panel-math .r2-math-row--new{border-left-color:#10b981;background:rgba(16,185,129,.06)}
.r2-panel-math .r2-math-row--covered{border-left-color:#27272a}
.r2-math-row-top{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px}
.r2-math-row-cat{font-size:13px;color:#d4d4d8;display:flex;align-items:center;gap:6px}
.r2-math-row--covered .r2-math-row-cat{color:#71717a}
.r2-math-row-val{font-size:13px;font-weight:600;color:#fafafa;font-variant-numeric:tabular-nums}
.r2-math-row--covered .r2-math-row-val{color:#71717a}
.r2-math-row-pill{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
  color:#10b981;border:1px solid #10b981;border-radius:4px;padding:1px 5px;vertical-align:middle}
.r2-math-bar-track{height:4px;background:#18181b;border-radius:2px;overflow:hidden}
.r2-math-bar-fill{height:100%;border-radius:2px;transition:width .3s}
/* Fee + net lines for Phase 2 math */
.r2-math-feeline{
  display:flex;justify-content:space-between;align-items:baseline;
  padding:8px 0 0;margin-top:10px;border-top:1px solid #1f1f23;font-size:13px}
.r2-math-feeline-lbl{color:#fafafa;display:flex;gap:6px;align-items:baseline;flex-wrap:wrap}
.r2-math-feeline-val{color:#fafafa;font-weight:600;font-variant-numeric:tabular-nums}
.r2-math-strike{text-decoration:line-through;color:#71717a}
.r2-math-waived{color:#10b981;font-weight:600;font-size:12px}
.r2-math-net{
  display:flex;justify-content:space-between;align-items:baseline;
  padding:8px 0 0;margin-top:4px;border-top:1px solid #27272a;
  font-size:13px;font-weight:700;color:#fafafa}
.r2-math-net-val{font-size:18px;font-weight:800;color:#10b981;font-variant-numeric:tabular-nums}
/* Marginal reconciliation block */
.r2-math-marginal{
  margin-top:14px;padding:10px 12px;background:#09130f;
  border:1px solid #1a3327;border-radius:9px}
.r2-math-marginal-hd{font-size:11px;font-weight:700;text-transform:uppercase;
  letter-spacing:.06em;color:#6ee7b7;margin-bottom:8px}
.r2-math-marginal-row{display:flex;justify-content:space-between;font-size:12.5px;
  color:#fafafa;padding:3px 0}
.r2-math-marginal-row--total{
  border-top:1px solid #1a3327;margin-top:4px;padding-top:7px;
  font-weight:700;color:#fafafa}
.r2-math-marginal-approx{color:#10b981;font-variant-numeric:tabular-nums}
.r2-math-marginal-net{color:#10b981;font-variant-numeric:tabular-nums;font-size:14px}
.r2-math-marginal-note{
  font-size:10.5px;color:#71717a;margin-top:6px;line-height:1.4;font-style:italic}
/* Upside note Phase 2 */
.r2-math-upside{
  margin-top:10px;font-size:12px;color:#fafafa;line-height:1.5;
  background:#18140a;border:1px solid #3a2f10;border-radius:9px;padding:9px 11px}

/* ── Priorities panel context note (combo) ── */
.r2-pri-context{
  font-size:12px;color:#71717a;margin-bottom:12px;line-height:1.4}
.r2-pri-context b{color:#fafafa}

/* ── Priorities panel ── */
.r2-pri-row{display:flex;gap:10px;font-size:13px;padding:8px 0;
  border-bottom:1px solid #141416;align-items:flex-start}
.r2-pri-row:last-child{border-bottom:none}
.r2-pri-glyph{font-size:14px;font-weight:800;width:18px;flex-shrink:0;margin-top:1px}
.r2-pri-row.met .r2-pri-glyph{color:#10b981}
.r2-pri-row.partial .r2-pri-glyph{color:#f59e0b}
.r2-pri-row.unmet .r2-pri-glyph{color:#71717a}
.r2-pri-label{color:#fafafa;font-weight:600;font-size:13px}
.r2-pri-line{color:#fafafa;font-size:12.5px;margin-top:2px;line-height:1.45}

/* ── Things to know panel ── */
.r2-item.know{align-items:flex-start}
.r2-know-group-sep{
  display:flex;align-items:center;gap:8px;margin:10px 0 6px;
}
.r2-know-group-sep::before,.r2-know-group-sep::after{
  content:'';flex:1;height:1px;background:#27272a}
.r2-know-group-label{
  font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
  color:#71717a;white-space:nowrap}
.r2-know-group-only-label{
  font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
  color:#71717a;margin-bottom:6px}
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
  padding:12px 6px 13px;font-size:11.5px;font-weight:600;color:#71717a;
  cursor:pointer;text-align:center;border-bottom:2px solid transparent;
  margin-bottom:-1px;transition:color .15s,border-color .15s;line-height:1.3;
  position:relative}
.r2-lowtabbtn:not(:last-child)::after{
  content:'';position:absolute;right:0;top:22%;height:56%;
  width:1px;background:#27272a}
.r2-lowtabbtn:hover{color:#fafafa}
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
.r2-lc-val{color:#fafafa;flex-shrink:0;font-variant-numeric:tabular-nums}
.r2-lc-badge{
  background:#18181b;color:#a78bfa;font-size:9.5px;font-weight:700;
  text-transform:uppercase;letter-spacing:.04em;padding:2px 6px;
  border-radius:5px;border:1px solid #8b5cf633}
.r2-lc-note{font-size:12px;color:#71717a;line-height:1.55;padding-top:2px}

/* eligibility rows */
.r2-elig{display:flex;align-items:center;gap:10px;font-size:13px;
  padding:7px 0;border-bottom:1px solid #141416}
.r2-elig:last-of-type{border-bottom:none}
.r2-elig-n{font-size:15px;font-weight:700;width:46px;flex-shrink:0}
.r2-elig.yes .r2-elig-n{color:#10b981}
.r2-elig.no .r2-elig-n{color:#71717a}
.r2-elig-t{color:#d4d4d8}
.r2-elig.no .r2-elig-t{color:#fafafa}

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
.r2-pri-bridge{font-size:13px;color:#fafafa;line-height:1.55;margin-top:12px;padding:10px 12px;background:#18181b;border-radius:8px;border:1px solid #27272a}
.r2-pri-bridge b{color:#fafafa;font-weight:600}
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
  margin-left:auto;color:#71717a;font-size:18px;line-height:1;
  transition:transform .2s;display:inline-block;transform:rotate(90deg)}
.r2-xfr-chev.open{transform:rotate(-90deg)}

/* Expanded body */
.r2-xfr-body{padding:0 18px 16px;border-top:1px solid rgba(255,255,255,.05)}
.r2-xfr-desc{
  font-size:12.5px;color:#fafafa;line-height:1.6;margin:12px 0 14px}

.r2-xfr-rows{display:flex;flex-direction:column;gap:10px;margin-bottom:14px}
.r2-xfr-row{display:flex;gap:10px;align-items:flex-start}
.r2-xfr-pill{
  flex-shrink:0;font-size:9.5px;font-weight:700;text-transform:uppercase;
  letter-spacing:.06em;padding:3px 8px;border-radius:6px;margin-top:2px}
.r2-xfr-pill.flight{background:rgba(6,182,212,.12);color:#06b6d4;border:1px solid rgba(6,182,212,.2)}
.r2-xfr-pill.hotel{background:rgba(139,92,246,.12);color:#a78bfa;border:1px solid rgba(139,92,246,.2)}
.r2-xfr-text{font-size:12.5px;color:#fafafa;line-height:1.6}

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
  font-size:10.5px;color:#71717a;line-height:1.5;
  padding-top:10px;border-top:1px solid rgba(255,255,255,.05)}

/* ── Credit note ── */
.r2-creditnote{
  margin-top:14px;padding:10px 14px;border-radius:10px;font-size:12.5px;
  color:#fbbf24;background:rgba(251,191,36,.07);border:1px solid rgba(251,191,36,.18);
  line-height:1.55}

/* ── Nav ── */
.r2-nav{display:flex;gap:8px;margin-top:16px}
.r2-nav--bottom{margin-top:32px;grid-column:1/-1}
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
.r2-owned-earn-line{font-size:12px;color:#fafafa;text-align:center;margin:6px 0 10px;line-height:1.4}
.r2-carousel-arrow{
  flex-shrink:0;width:32px;height:32px;border-radius:50%;
  background:#18181b;border:1px solid #3f3f46;color:#fafafa;
  font-size:20px;line-height:1;cursor:pointer;
  display:flex;align-items:center;justify-content:center;
  transition:background .15s,border-color .15s,color .15s;
  font-family:inherit;padding:0;
  /* arrows must paint above the absolute-positioned card tile (z-index:5) */
  position:relative;z-index:10;
  /* offset down by half the dots row height so arrow centres on the card, not card+dots */
  margin-bottom:20px}
.r2-carousel-arrow:hover{background:#27272a;border-color:#71717a;color:#fafafa}
.r2-carousel-body{flex:1;min-width:0}
.r2-carousel-dots{display:flex;justify-content:center;gap:6px;margin-top:8px}
.r2-carousel-dot{
  width:7px;height:7px;border-radius:50%;
  background:#3f3f46;border:none;cursor:pointer;padding:0;
  transition:background .15s,transform .15s}
.r2-carousel-dot.on{background:#10b981;transform:scale(1.25)}

/* Fix 3: verdict earn line — raise from 8px to readable size */
.r2-left--a .r2-pc-vline{font-size:10.5px}

/* ── Hero row — flex to place ⓘ button beside the number ── */
.r2-hero-row{display:flex;align-items:center;gap:10px}

/* ── Clarity info button + popover ── */
.r2-clarity-btn{
  flex-shrink:0;background:none;border:none;cursor:pointer;
  font-size:16px;color:#71717a;line-height:1;padding:2px;
  transition:color .15s;margin-bottom:2px}
.r2-clarity-btn:hover,.r2-clarity-btn.on{color:#fafafa}
.r2-clarity-popover{
  font-size:12px;color:#fafafa;line-height:1.6;
  background:#0c0c0e;border:1px solid #27272a;border-radius:10px;
  padding:10px 13px;margin-top:6px;margin-bottom:10px}

/* ── Owned card stack supporting text ── */
.r2-owned-divider{border:none;border-top:1px solid #27272a;margin:20px 0 16px}

/* ── Routing map (Journey A — best owned card per spend category) ── */
.r2-routemap{
  margin-top:20px;background:#0c0c0e;border:1px solid #1f1f23;
  border-radius:14px;padding:14px 16px;overflow:hidden}
.r2-routemap-heading{margin-bottom:10px}
.r2-routemap-row{
  display:grid;grid-template-columns:1fr auto auto;align-items:center;
  gap:6px 10px;padding:7px 0;border-bottom:1px solid #141416;font-size:13px}
.r2-routemap-row:last-child{border-bottom:none}
.r2-routemap-cat{color:#fafafa;font-weight:600;font-size:12px}
.r2-routemap-card{color:#fafafa;font-weight:600;text-align:right}
.r2-routemap-val{
  color:#10b981;font-weight:700;font-variant-numeric:tabular-nums;
  text-align:right;white-space:nowrap;font-size:12px}
/* Leaking spend — muted, flagged, no value column */
.r2-routemap-row.leak{opacity:.55}
.r2-routemap-row.leak .r2-routemap-cat{color:#fafafa}
.r2-routemap-leak-note{
  grid-column:2 / 4;text-align:right;
  font-size:11px;color:#71717a;font-style:italic}
/* Active card is the winner in this category */
.r2-routemap-row.active-best .r2-routemap-cat{color:#fafafa;font-weight:600}
/* Comparison line — spans full width below the main row columns */
.r2-routemap-compare{
  grid-column:1 / 4;font-size:11px;color:#71717a;
  padding-bottom:4px;line-height:1.5}

/* ── "Why this recommendation" tag (Journey A — gap-fill and rate-beating variants) ── */
.r2-gaptag{
  display:flex;align-items:flex-start;gap:9px;
  border-radius:10px;padding:10px 13px;margin-bottom:16px;line-height:1.5}
/* Gap-fill variant — purple */
.r2-gaptag--gap{
  background:rgba(139,92,246,.08);border:1px solid rgba(139,92,246,.25)}
.r2-gaptag--gap .r2-gaptag-pill{
  background:rgba(139,92,246,.22);color:#a78bfa;border:1px solid rgba(139,92,246,.35)}
.r2-gaptag--gap .r2-gaptag-text{color:#c4b5fd}
/* Rate-beating variant — teal */
.r2-gaptag--beat{
  background:rgba(6,182,212,.07);border:1px solid rgba(6,182,212,.22)}
.r2-gaptag--beat .r2-gaptag-pill{
  background:rgba(6,182,212,.16);color:#67e8f9;border:1px solid rgba(6,182,212,.3)}
.r2-gaptag--beat .r2-gaptag-text{color:#a5f3fc}
/* Shared */
.r2-gaptag-pill{
  flex-shrink:0;font-size:9px;font-weight:800;text-transform:uppercase;
  letter-spacing:.07em;padding:2px 7px;border-radius:5px;
  align-self:flex-start;margin-top:1px;white-space:nowrap}
.r2-gaptag-text{font-size:12px;min-width:0;word-break:break-word}
.r2-gaptag-text b{color:#fafafa;font-weight:700}

/* ── Verdict proof (Journey A owned card expandable breakdown) ── */
.r2-vproof-wrap{margin-top:2px;margin-bottom:4px}
.r2-vproof-toggle{
  background:none;border:none;color:#fafafa;font-family:inherit;
  font-size:12px;font-weight:600;cursor:pointer;padding:6px 0 2px;display:block;
  width:100%;text-align:center;transition:color .15s}
.r2-vproof-toggle:hover{color:#fafafa}
.r2-vproof{
  background:#0c0c0e;border:1px solid #1f1f23;border-radius:10px;
  padding:10px 13px;margin-top:4px}
.r2-vproof-head{
  font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
  color:#71717a;margin-bottom:8px}
.r2-vproof-row{
  display:grid;grid-template-columns:1fr auto auto;align-items:center;
  gap:4px 8px;padding:5px 0;border-bottom:1px solid #141416;font-size:12px}
.r2-vproof-row:last-child{border-bottom:none}
.r2-vproof-row.best .r2-vproof-cat{color:#fafafa;font-weight:600}
.r2-vproof-row.zero{opacity:.55}
.r2-vproof-cat{color:#fafafa}
.r2-vproof-earn{color:#fafafa;font-weight:600;font-variant-numeric:tabular-nums;text-align:right}
.r2-vproof-rate{font-size:10.5px;color:#fafafa;font-weight:400}
.r2-vproof-excl{color:#71717a;font-style:italic;font-weight:400}
.r2-vproof-nodata{color:#71717a;font-style:italic;font-weight:400}
.r2-vproof-zero{color:#71717a;font-weight:400}
.r2-vproof-best{
  font-size:8.5px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;
  color:#10b981;background:rgba(16,185,129,.12);border:1px solid rgba(16,185,129,.2);
  border-radius:4px;padding:1px 5px;white-space:nowrap}
/* UNDERUSED proof */
.r2-underused-note{
  font-size:12px;color:#fbbf24;background:rgba(251,191,36,.07);
  border:1px solid rgba(251,191,36,.2);border-radius:8px;
  padding:8px 10px;margin-bottom:10px;line-height:1.5}
.r2-underused-cols-head{
  display:grid;grid-template-columns:1fr auto auto;gap:4px 10px;
  font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
  color:#71717a;padding:0 0 4px;border-bottom:1px solid #27272a;margin-bottom:4px}
.r2-underused-cols-head span:nth-child(2),.r2-underused-cols-head span:nth-child(3){text-align:right}
.r2-underused-cols{
  display:grid;grid-template-columns:1fr auto auto;gap:2px 10px;
  align-items:center;padding:5px 0;border-bottom:1px solid #1f1f23;font-size:12.5px}
.r2-underused-cols--bonus .r2-vproof-cat{color:#e4e4e7}
.r2-underused-base{text-align:right;color:#fafafa;font-size:12px;white-space:nowrap}
.r2-underused-bonus{text-align:right;white-space:nowrap}
.r2-underused-bonus-val{color:#fbbf24;font-size:12px;display:flex;align-items:center;gap:4px;justify-content:flex-end;flex-wrap:wrap}
.r2-underused-cap{
  font-size:10px;color:#a16207;white-space:nowrap}
.r2-underused-cond{
  font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;
  color:#fbbf24;border:1px solid rgba(251,191,36,.3);border-radius:4px;padding:1px 4px}
.r2-underused-routing{
  margin:10px 0 2px;padding:9px 11px;border-radius:8px;
  background:rgba(99,102,241,.07);border:1px solid rgba(99,102,241,.18);
  font-size:12px;color:#fafafa;line-height:1.55}
.r2-underused-routing b{color:#e4e4e7}
.r2-underused-footer{
  margin-top:8px;padding-top:8px;border-top:1px solid #27272a;
  font-size:11px;color:#71717a}
.r2-underused-footer b{color:#e4e4e7}
.r2-underused-sentences{font-size:13px;color:#fafafa;line-height:1.6;margin-bottom:12px}
.r2-underused-sentences p{margin:0 0 6px}
.r2-underused-sentences p:last-child{margin-bottom:0}
.r2-underused-sentences b{color:#e4e4e7}
.r2-underused-upside-line{color:#fafafa!important}
.r2-underused-unlock{margin-top:10px;background:#1c1200;border:1px solid #92400e;border-radius:8px;padding:10px 12px}
.r2-underused-unlock-head{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#f59e0b;margin-bottom:6px}
.r2-underused-unlock{font-size:12.5px;color:#d4d4d8;line-height:1.55}
.r2-underused-unlock-caveat{margin-top:6px;font-size:11px;color:#fafafa}
.r2-verdict-oneliner{font-size:13px;color:#fafafa;line-height:1.6;margin-bottom:12px}
.r2-verdict-oneliner b{color:#e4e4e7}

/* ── Why-panel 3-level structure ── */
.r2-why-levels{display:flex;flex-direction:column;gap:16px}
.r2-why-level{background:#0c0c0e;border:1px solid #27272a;border-radius:12px;padding:14px 16px}
.r2-why-level-head{display:flex;align-items:center;justify-content:space-between;
  font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
  color:#71717a;margin-bottom:10px}
.r2-why-total{font-size:12px;font-weight:800;color:#10b981;letter-spacing:0}
.r2-why-rate-toggle{margin-top:10px;background:none;border:none;color:#71717a;
  font-size:11px;font-weight:600;cursor:pointer;padding:0;text-decoration:underline}
.r2-why-rate-toggle:hover{color:#fafafa}
.r2-why-excluded{font-size:12.5px;color:#d4d4d8;line-height:1.55;
  background:#1c1506;border:1px solid #6b5410;border-radius:8px;padding:10px 12px}
.r2-why-excluded b{color:#f59e0b}

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
  font-weight:600;color:#fafafa;display:flex;justify-content:space-between;align-items:center}
.r2-fold>summary::-webkit-details-marker{display:none}
.r2-fold>summary:hover{color:#e4e4e7}
.r2-fold>summary::after{content:'⌄';font-size:16px;color:#71717a;transition:transform .2s}
.r2-fold[open]>summary::after{transform:rotate(180deg)}
.r2-fold[open]>summary{border-bottom:1px solid #1f1f23}
.r2-fold-body{padding:8px 14px 4px}
.r2-fold-global-warns{padding:12px 16px 8px}
.r2-global-bank-group{margin-bottom:14px}
.r2-global-bank-group:last-child{margin-bottom:4px}
.r2-global-bank-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#71717a;margin-bottom:6px}

/* ── Balance calc card picker (Journey A) ── */
.r2-fold-cardpick{display:flex;align-items:center;gap:8px;padding:10px 16px 0}
.r2-fold-cardlabel{font-size:11px;font-weight:700;color:#fafafa;flex-shrink:0;text-transform:uppercase;letter-spacing:.05em}
.r2-fold-cardsel{
  flex:1;background:#18181b;border:1px solid #3f3f46;border-radius:8px;
  color:#e4e4e7;font-family:'DM Sans',system-ui,sans-serif;font-size:13px;
  font-weight:600;padding:6px 10px;cursor:pointer;outline:none}
.r2-fold-cardsel:focus{border-color:#71717a}

/* ── Combined per-category map (Phase 2 — owned + recommended) ── */
.r2-combined-map{margin-top:20px;margin-bottom:4px}
.r2-phase2-right .r2-iconrow{margin-top:20px}
.r2-routemap-row.rec-wins .r2-routemap-card{color:#10b981}
.r2-combined-new{
  display:inline-block;font-size:8px;font-weight:800;text-transform:uppercase;
  letter-spacing:.06em;color:#10b981;background:rgba(16,185,129,.13);
  border:1px solid rgba(16,185,129,.25);border-radius:4px;
  padding:1px 5px;margin-left:6px;vertical-align:middle}
.r2-combined-delta{
  font-size:11px;color:#71717a;padding:6px 0 2px;line-height:1.5}
.r2-combined-delta-note{color:#71717a}

/* ── Net equation: current + gain = total ── */
/* ── Plain-language scenario box (replaces net equation) ── */
.r2-scenario-box{
  margin-top:10px;border-top:1px solid #1f1f23;padding-top:10px;
  font-size:13px;color:#fafafa;line-height:1.6}
.r2-scenario-box b{color:#fafafa;font-weight:600}
.r2-scenario-meta{font-size:12px;color:#fafafa;line-height:1.55;margin-top:8px}
.r2-scenario-meta b{color:#fafafa;font-weight:600}
.r2-scenario-tab-hint{color:#a1a1aa}
.r2-scenario-excl b{color:#f59e0b}

/* ── Model B two-phase layout (Journey A) ── */
.r2-phase1{margin:0}
/* Phase 2 spans full grid width */
.r2-phase2{grid-column:1/-1;margin-top:0;padding-top:24px;border-top:1px solid #1f1f23;position:relative;z-index:1}

/* Phase 2 inner sub-grid: left = hero + why-tag + card tile; right = combined map + icon row + detail panel */
.r2-phase2-grid{display:grid;grid-template-columns:380px 1fr;gap:32px;align-items:start;margin-bottom:16px}

/* Phase 2 eyebrow */
.r2-phase2-left{text-align:center}
.r2-phase2-left .r2-hero-row{justify-content:center}
.r2-phase2-eyebrow{margin-bottom:4px}
.r2-phase2-left .r2-gaptag{text-align:left}

/* CTA button between Phase 1 and Phase 2 */
.r2-phase2-cta{
  display:block;width:100%;margin-top:20px;
  background:#18181b;border:1px solid #3f3f46;border-radius:12px;
  color:#fafafa;font-family:'DM Sans',system-ui,sans-serif;font-size:14px;
  font-weight:700;padding:14px 20px;cursor:pointer;text-align:center;
  transition:background .15s,border-color .15s,color .15s}
.r2-phase2-cta:hover{background:#1f1f23;border-color:#52525b;color:#e4e4e7}
.r2-phase2-cta.open{border-color:#10b981;color:#10b981}
.r2-phase2-cta.open:hover{background:rgba(16,185,129,.06)}

/* Routing map — Phase 1 full-width variant */
.r2-routemap--p1{margin-top:16px}
.r2-routemap-heading-row{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:10px}
.r2-routemap-heading-row .r2-routemap-heading{margin-bottom:0}
.r2-routemap-sub{font-size:11px;color:#71717a;font-style:italic}
.r2-routemap-total{
  display:grid;grid-template-columns:1fr auto;align-items:center;
  gap:6px 10px;padding:8px 0 2px;margin-top:4px;border-top:1px solid #27272a}
.r2-routemap-total-lbl{font-size:12px;font-weight:700;color:#fafafa;text-transform:uppercase;letter-spacing:.05em}
.r2-routemap-total-val{font-size:14px;font-weight:800;color:#10b981;font-variant-numeric:tabular-nums;text-align:right}
.r2-portcard-explainer{font-size:12px;color:#71717a;line-height:1.6;margin-top:10px}
.r2-portcard-explainer b{color:#fafafa}

/* Owned-card hack fold in Phase 1 */
.r2-fold--p1hack{margin-top:14px}

/* Phase 2 recommendation tile: center-align to match Phase 1 carousel position */
.r2-phase2 .r2-solo-stack{width:260px;margin:0 auto 12px}

/* Carousel card: in-flow so it cannot overflow carousel body and cover the right arrow */
.r2-pcard-flow{position:relative!important;left:auto!important;width:100%!important;max-width:260px;margin:0 auto 12px;display:block}

/* ── See-how derivation ── */
.r2-seehow{margin:10px 0 14px}
.r2-seehow-btn{background:none;border:none;padding:0;font-size:12px;color:#6ee7b7;cursor:pointer;font-family:inherit;letter-spacing:.02em}
.r2-seehow-btn:hover{color:#34d399}
.r2-seehow-rows{margin-top:8px;display:flex;flex-direction:column;gap:4px;background:#18181b;border:1px solid #27272a;border-radius:8px;padding:10px 12px}
.r2-seehow-row{display:flex;justify-content:space-between;align-items:center;font-size:12px;color:#fafafa}
.r2-seehow-row--total{border-top:1px solid #3f3f46;margin-top:4px;padding-top:6px;color:#f4f4f5;font-weight:600}
.r2-seehow-val{font-variant-numeric:tabular-nums}
.r2-seehow-val--pos{color:#10b981}
.r2-seehow-val--neg{color:#f87171}
`;

export default ResultsScreenV2;
