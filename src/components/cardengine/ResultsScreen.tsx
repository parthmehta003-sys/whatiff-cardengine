/**
 * ResultsScreen.tsx — the payoff screen. Composes everything from a RankResult:
 * journey-aware recommendations, combo label, Journey-A owned verdicts, runners-up, premium band,
 * transparency block, credit note, and the APR/EMI calculator.
 *
 * All numbers come from the engine via RankResult. Pure presentation.
 */
import React, { useState } from 'react';
import type { RankResult, RankedCard, CardMeta, Priorities } from '../../lib/cardEngine/rankCards';
import type { MonthlySpend } from '../../lib/cardEngine/computeEarn';
import { evaluatePriorities, LABEL, type PriorityEval, type AlternativeForPriority } from '../../lib/cardEngine/evaluatePriorities';
import RecommendationCard, { DevaluationFlag } from './RecommendationCard';
import { CardTile } from './CardTile';
import AprEmiCalculator from './AprEmiCalculator';
import type { SelectedHack, SurfacedInsight } from '../../lib/cardEngine/selectHacks';

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

interface Props {
  result: RankResult;
  monthlySpend: MonthlySpend;
  isTravelPriority?: boolean;
  /** optional per-card devaluation flags keyed by cardId (from DISCONTINUED_WARNINGS). */
  devaluations?: Record<string, DevaluationFlag>;
  /** selected hack per cardId (from selectHackForCard). */
  hacks?: Record<string, SelectedHack | null>;
  /** Layer-3 intelligence per cardId (from cardIntelligence). */
  intelligence?: Record<string, { type: string; text: string; severity?: string | null }[]>;
  /** value-first pros/cons per cardId (from buildCardNarrative). */
  narratives?: Record<string, { topPros: { text: string; valuePerYear: number }[]; topCons: { text: string; valuePerYear: number }[] }>;
  /** open the full Excel pros/cons list for a card. */
  onKnowMore?: (cardId: string) => void;
  /** cross-cutting insights to surface (top 2). */
  insights?: SurfacedInsight[];
  /** Journey B "leaving on the table" baseline: a typical/median eligible card's net. */
  baselineNet?: number;
  liquidity?: Map<string, { aprAnnualPct: number | null; emiConversionAprPct: number | null }>;
  /** the user's selected priority tiers — surfaced (never re-ranks). */
  priorities?: Priorities;
  /** pre-computed alt card for missed top priority (from CardEngine). */
  altForTop?: AlternativeForPriority | null;
  /** return to the previous step (priorities) with all inputs preserved. */
  onBack?: () => void;
  onRestart?: () => void;
}

export const ResultsScreen: React.FC<Props> = ({
  result, monthlySpend, isTravelPriority, devaluations, hacks, intelligence, narratives, onKnowMore, insights, baselineNet, liquidity, priorities, altForTop, onBack, onRestart,
}) => {
  const [altExpanded, setAltExpanded] = useState(false);

  const t = result.transparency;
  const journeyA = result.journey === 'owns_cards';
  const top = result.recommended[0];
  const eligibleCount = t.totalEvaluated - t.failedIncome - t.failedFee;
  // Combo becomes the hero recommendation (Journey B) whenever the engine surfaced one —
  // result.combo is only set when the 2-card setup beats the best single card by ≥ COMBO_MIN_GAIN.
  const comboHero = !journeyA && !!result.combo;
  // The headline net we compare against the baseline: the combo total when combo is hero, else the single card.
  const heroNet = comboHero ? result.combo!.netPerYear : top?.netGuaranteedPerYear;
  const onTable = !journeyA && heroNet != null && baselineNet != null
    ? Math.round(heroNet - baselineNet) : null;

  // Priorities surfacing — checks the recommended setup against what the user said they cared about.
  // Display-only: never re-ranks. Evaluated across the whole recommended setup (single card or combo).
  const priorityEvals = evaluatePriorities(priorities, result.recommended, monthlySpend);

  return (
    <div className="wf-res">
      <style>{css}</style>

      {/* Journey A verdict banner */}
      {journeyA && result.ownedVerdicts && result.ownedVerdicts.length > 0 && (
        <div className="wf-res-verdict">
          {result.ownedVerdicts.map((v) => (
            <div key={v.cardId} className={'wf-vrow wf-v-' + v.verdict}>
              <span className="wf-vbadge">{v.verdict.replace('_', ' ')}</span>
              <span className="wf-vreason"><b className="wf-vname">{v.cardName}</b> — {v.reason}</span>
            </div>
          ))}
          {top?.marginalGainPerYear != null && top.marginalGainPerYear > 0 && (
            <div className="wf-vgain">
              Adding our top pick lifts your setup by <b>+{inr(top.marginalGainPerYear)}/yr</b>.
            </div>
          )}
        </div>
      )}

      <div className="wf-res-h">
        {journeyA ? 'Cards that would improve your setup' : comboHero ? 'Your best setup' : 'Your top match'}
        <span className="wf-res-shape">{result.spendShape} spend</span>
      </div>

      {/* combo block — hero position when combo wins */}
      {result.combo && (() => {
        const combo = result.combo!;
        const cardContrib = (c: RankedCard) => {
          const cats = combo.assignments[c.cardId] ?? [];
          return cats.reduce((s, cat) => s + (c.earn.perCategory[cat]?.guaranteed ?? 0) * 12, 0);
        };
        return (
          <div className={'wf-res-combo' + (comboHero ? ' wf-res-combo-hero' : '')}>
            <div className="wf-combo-header">
              <span className="wf-res-combo-tag">best combo</span>
              <span className="wf-combo-together">Together: <b>{inr(combo.netPerYear)}/yr</b></span>
            </div>
            {result.recommended.map((c, i) => {
              const cats = combo.assignments[c.cardId] ?? [];
              const contrib = cardContrib(c);
              return (
                <React.Fragment key={c.cardId}>
                  {i > 0 && <div className="wf-combo-divider" />}
                  <div className="wf-combo-card">
                    <div className="wf-combo-tile">
                      <CardTile cardName={c.meta.name} issuer={(c.meta as CardMeta).bank ?? ''} />
                    </div>
                    <div className="wf-combo-info">
                      <div className="wf-combo-namerow">
                        <span className="wf-combo-name">{c.meta.name}</span>
                        <span className="wf-combo-val">{inr(contrib)}/yr</span>
                      </div>
                      <div className="wf-combo-cats2">{cats.join(' · ')}</div>
                    </div>
                  </div>
                </React.Fragment>
              );
            })}
            {comboHero && onTable != null && onTable > 0 && (
              <div className="wf-combo-footnote">
                You&rsquo;re leaving <b>{inr(onTable)}/year</b> on the table with a single card.
              </div>
            )}
          </div>
        );
      })()}

      {/* single-card Journey B baseline line — shown only when no combo */}
      {!journeyA && !comboHero && onTable != null && onTable > 0 && (
        <div className="wf-res-ontable-line">
          <b>{inr(onTable)}/year</b> better than an average card you&rsquo;d qualify for.
        </div>
      )}

      {/* recommended cards */}
      {comboHero && <div className="wf-res-sub">In this combo</div>}
      <div className="wf-res-cards">
        {result.recommended.map((c, i) => (
          <RecommendationCard
            key={c.cardId}
            isInCombo={!!result.combo}
            card={c}
            monthlySpend={monthlySpend}
            rank={i + 1}
            isTravelPriority={isTravelPriority}
            forexPct={(c.meta as CardMeta).forexPct}
            devaluation={devaluations?.[c.cardId]}
            hack={hacks?.[c.cardId] ? {
              name: hacks[c.cardId]!.name,
              whyItMatters: hacks[c.cardId]!.whyItMatters,
              executionSteps: hacks[c.cardId]!.executionSteps,
              difficulty: hacks[c.cardId]!.difficulty,
              status: hacks[c.cardId]!.status,
              commonFailure: hacks[c.cardId]!.commonFailure,
              lastVerified: hacks[c.cardId]!.lastVerified,
              matchedOnSpend: hacks[c.cardId]!.matchedOnSpend,
              locked: hacks[c.cardId]!.locked,
            } : undefined}
            intelligence={intelligence?.[c.cardId]}
            narrative={narratives?.[c.cardId]}
            onKnowMore={onKnowMore ? () => onKnowMore(c.cardId) : undefined}
          />
        ))}
      </div>

      {/* Your priorities — supports the recommendation (not a competing verdict) */}
      {priorityEvals.length > 0 && (
        <PrioritiesSection evals={priorityEvals} />
      )}

      {/* Trade-off when the TOP priority is missed — informational, never re-ranks */}
      {altForTop && (
        <div className="wf-pri-alt">
          <button className="wf-alt-header" onClick={() => setAltExpanded((v) => !v)}>
            <span className="wf-alt-header-text">
              Your optimal setup earns <b>{inr(altForTop.optimalNet)}</b>. The closest setup that covers{' '}
              {LABEL[altForTop.key]} is <b>{altForTop.card.meta.name}</b>, earning {inr(altForTop.altNet)}{' '}
              — that&rsquo;s <b>{inr(altForTop.costOfSwitch)} less</b>. Your call.
            </span>
            <span className={'wf-alt-chev' + (altExpanded ? ' open' : '')}>⌄</span>
          </button>
          {altExpanded && (
            <div className="wf-alt-card">
              <RecommendationCard
                card={altForTop.card}
                monthlySpend={monthlySpend}
                forexPct={(altForTop.card.meta as CardMeta).forexPct}
                isTravelPriority={isTravelPriority}
                devaluation={devaluations?.[altForTop.card.cardId]}
                hack={hacks?.[altForTop.card.cardId] ? {
                  name: hacks[altForTop.card.cardId]!.name,
                  whyItMatters: hacks[altForTop.card.cardId]!.whyItMatters,
                  executionSteps: hacks[altForTop.card.cardId]!.executionSteps,
                  difficulty: hacks[altForTop.card.cardId]!.difficulty,
                  status: hacks[altForTop.card.cardId]!.status,
                  commonFailure: hacks[altForTop.card.cardId]!.commonFailure,
                  lastVerified: hacks[altForTop.card.cardId]!.lastVerified,
                  matchedOnSpend: hacks[altForTop.card.cardId]!.matchedOnSpend,
                  locked: hacks[altForTop.card.cardId]!.locked,
                } : undefined}
                intelligence={intelligence?.[altForTop.card.cardId]}
                narrative={narratives?.[altForTop.card.cardId]}
                onKnowMore={onKnowMore ? () => onKnowMore(altForTop.card.cardId) : undefined}
              />
            </div>
          )}
        </div>
      )}

      {/* cross-cutting insights */}
      {insights && insights.length > 0 && (
        <div className="wf-res-insights">
          {insights.map((ins, i) => (
            <div key={i} className="wf-insight">
              <span className="wf-insight-tag">good to know</span>
              <b>{ins.topic}.</b> {ins.description}
            </div>
          ))}
        </div>
      )}

      {/* flat-spend generalist note */}
      {result.flatSpendNote && <div className="wf-res-flat">{result.flatSpendNote}</div>}

      {/* premium worth-considering band */}
      {result.premiumWorthConsidering && result.premiumWorthConsidering.length > 0 && (
        <>
          <div className="wf-res-sub">Outside your fee preference — worth considering</div>
          <div className="wf-res-runners">
            {result.premiumWorthConsidering.map((c) => <RunnerRow key={c.cardId} c={c} accent="#f59e0b" />)}
          </div>
        </>
      )}

      {/* runners-up — collapsed by default */}
      {result.runnersUp.length > 0 && (
        <details className="wf-fold">
          <summary>{journeyA ? 'Other additions we considered' : 'Others we considered'} ({result.runnersUp.length})</summary>
          <div className="wf-res-runners">
            {result.runnersUp.map((c) => <RunnerRow key={c.cardId} c={c} journeyA={journeyA} />)}
          </div>
        </details>
      )}

      {/* transparency block — collapsed; one-line teaser in the summary */}
      <details className="wf-fold">
        <summary>How we picked · {t.totalEvaluated} cards evaluated, {eligibleCount} eligible</summary>
        <div className="wf-res-transp">
          <div className="wf-transp-rows">
            <div className="wf-transp-row wf-tr-ok">
              <span className="wf-tr-mark">✓</span><span className="wf-tr-n">{eligibleCount}</span>
              <span className="wf-tr-label">eligible for you</span>
            </div>
            {t.failedIncome > 0 && (
              <div className="wf-transp-row">
                <span className="wf-tr-mark wf-tr-x">✕</span><span className="wf-tr-n">{t.failedIncome}</span>
                <span className="wf-tr-label">income mismatch</span>
              </div>
            )}
            {t.failedFee > 0 && (
              <div className="wf-transp-row">
                <span className="wf-tr-mark wf-tr-x">✕</span><span className="wf-tr-n">{t.failedFee}</span>
                <span className="wf-tr-label">above your fee comfort</span>
              </div>
            )}
            {t.inviteOnly > 0 && (
              <div className="wf-transp-row">
                <span className="wf-tr-mark wf-tr-x">✕</span><span className="wf-tr-n">{t.inviteOnly}</span>
                <span className="wf-tr-label">invite-only</span>
              </div>
            )}
            {t.weakSpendMatch > 0 && (
              <div className="wf-transp-row">
                <span className="wf-tr-mark wf-tr-x">✕</span><span className="wf-tr-n">{t.weakSpendMatch}</span>
                <span className="wf-tr-label">weak fit for your spend</span>
              </div>
            )}
          </div>
        </div>
      </details>

      {result.creditNote && <div className="wf-res-credit">{result.creditNote}</div>}

      {/* APR/EMI calculator — collapsed; it's a tool, not part of the decision */}
      {top && (
        <details className="wf-fold">
          <summary>Thinking of carrying a balance? See what it costs</summary>
          <div className="wf-res-apr">
            <AprEmiCalculator
              cardName={top.meta.name}
              storedAprAnnualPct={liquidity?.get(top.cardId)?.aprAnnualPct ?? null}
              storedEmiAprAnnualPct={liquidity?.get(top.cardId)?.emiConversionAprPct ?? null}
            />
          </div>
        </details>
      )}

      {(onBack || onRestart) && (
        <div className="wf-res-nav">
          {onBack && <button className="wf-res-back" onClick={onBack}>Back</button>}
          {onRestart && <button className="wf-res-restart" onClick={onRestart}>Start over</button>}
        </div>
      )}
    </div>
  );
};

const RunnerRow: React.FC<{ c: RankedCard; journeyA?: boolean; accent?: string }> = ({ c, journeyA, accent }) => (
  <div className="wf-runner">
    <div>
      <div className="wf-runner-name">{c.meta.name}{c.inviteOnly && <span className="wf-runner-inv">invite</span>}</div>
      <div className="wf-runner-why">
        {c.meta.annualFee === 0 ? 'Lifetime Free' : 'Fee ' + inr(c.meta.annualFee)} · didn&rsquo;t lead for your spend
      </div>
    </div>
    <div className="wf-runner-net" style={accent ? { color: accent } : undefined}>
      {journeyA && c.marginalGainPerYear != null ? '+' + inr(c.marginalGainPerYear) : inr(c.netGuaranteedPerYear)}
    </div>
  </div>
);

// ── Your priorities section ──────────────────────────────────────────────────
const TIER_META: Record<PriorityEval['tier'], { label: string; cls: string }> = {
  top: { label: 'Top priority', cls: 'wf-pri-top' },
  secondary: { label: 'Secondary', cls: 'wf-pri-secondary' },
  niceToHave: { label: 'Nice to have', cls: 'wf-pri-nice' },
};
const STATUS_GLYPH: Record<PriorityEval['status'], string> = { met: '✓', partial: '⚠', unmet: '✗' };

const PrioritiesSection: React.FC<{ evals: PriorityEval[] }> = ({ evals }) => {
  const order: PriorityEval['tier'][] = ['top', 'secondary', 'niceToHave'];
  return (
    <div className="wf-pri">
      <div className="wf-pri-head">How this addresses your priorities</div>
      {order.map((tier) => {
        const rows = evals.filter((e) => e.tier === tier);
        if (rows.length === 0) return null;
        const meta = TIER_META[tier];
        return (
          <div key={tier} className={'wf-pri-tier ' + meta.cls}>
            <div className="wf-pri-tlabel">{meta.label}</div>
            {rows.map((e) => (
              <div key={e.key} className={'wf-pri-row wf-pri-' + e.status}>
                <span className="wf-pri-glyph">{STATUS_GLYPH[e.status]}</span>
                <span className="wf-pri-line">{e.line}</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
};

const css = `
.wf-res{font-family:'DM Sans',system-ui,sans-serif;max-width:560px;margin:0 auto;color:#e4e4e7;display:flex;flex-direction:column;gap:13px}
.wf-res-verdict{background:#0a1f16;border:1px solid #1a6b46;border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:9px}
.wf-vrow{display:flex;align-items:baseline;gap:10px}
.wf-vbadge{font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;padding:3px 7px;border-radius:5px;flex:0 0 auto}
.wf-v-keep .wf-vbadge{background:#0d2c1c;color:#34d399;border:1px solid #1a6b46}
.wf-v-underused .wf-vbadge{background:#2a2406;color:#fbbf24;border:1px solid #6b5410}
.wf-v-wrong_fit .wf-vbadge{background:#2a0f0f;color:#f87171;border:1px solid #6b1d1d}
.wf-vreason{font-size:12.5px;color:#e4e4e7;line-height:1.45}
.wf-vname{color:#fafafa;font-weight:700}
.wf-vgain{font-size:13px;color:#a7f3d0;padding-top:6px;border-top:1px solid #1a6b46}
.wf-vgain b{color:#fafafa}
.wf-res-h{display:flex;justify-content:space-between;align-items:baseline;font-size:16px;font-weight:800;color:#fafafa;margin-top:6px;letter-spacing:-.01em}
.wf-res-shape{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#a78bfa}
.wf-res-combo{background:#0a1410;border:1px solid #1a6b46;border-radius:12px;overflow:hidden;font-size:13px;color:#e4e4e7}
.wf-res-combo-hero{border-color:#10b981;box-shadow:0 0 0 1px #10b981 inset,0 8px 30px rgba(0,0,0,.4)}
.wf-combo-header{display:flex;align-items:center;justify-content:space-between;padding:11px 14px 11px;border-bottom:1px solid #1a3d28}
.wf-res-combo-tag{display:inline-block;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#34d399;border:1px solid #1a6b46;border-radius:4px;padding:2px 6px}
.wf-combo-together{font-size:13px;color:#a1a1aa}
.wf-combo-together b{color:#10b981;font-weight:800;font-variant-numeric:tabular-nums}
.wf-combo-card{display:flex;align-items:center;gap:12px;padding:12px 14px}
.wf-combo-tile{width:72px;flex-shrink:0}
.wf-combo-info{flex:1;min-width:0}
.wf-combo-namerow{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.wf-combo-name{font-size:13.5px;font-weight:700;color:#fafafa;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.wf-combo-val{font-size:13px;font-weight:700;color:#34d399;font-variant-numeric:tabular-nums;white-space:nowrap;flex-shrink:0}
.wf-combo-cats2{font-size:11.5px;color:#52525b;margin-top:3px;line-height:1.4}
.wf-combo-divider{height:1px;background:#27272a;margin:0 14px}
.wf-combo-footnote{margin:0;padding:10px 14px;border-top:1px solid #1a3d28;font-size:12px;color:#6b7280;line-height:1.5}
.wf-combo-footnote b{color:#10b981;font-weight:700;font-variant-numeric:tabular-nums}
.wf-res-ontable-line{font-size:13px;color:#a1a1aa;padding:2px 0}
.wf-res-ontable-line b{color:#10b981;font-weight:800;font-variant-numeric:tabular-nums}
.wf-res-cards{display:flex;flex-direction:column;gap:13px}
.wf-res-insights{display:flex;flex-direction:column;gap:8px}
.wf-insight{background:#0c0c0e;border:1px solid #2a2a30;border-radius:11px;padding:11px 14px;font-size:12.5px;color:#d4d4d8;line-height:1.55}
.wf-insight b{color:#fafafa}
.wf-insight-tag{display:inline-block;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#06b6d4;border:1px solid #155e6b;border-radius:4px;padding:1px 6px;margin-right:8px}
.wf-res-flat{background:#0c0c0e;border:1px solid #2a2a30;border-radius:11px;padding:12px 14px;font-size:12.5px;color:#c4c4c8;line-height:1.5}
.wf-res-sub{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#a1a1aa;margin-top:8px}
/* Your priorities — a supporting panel, deliberately quieter than the recommendation cards. */
.wf-pri{background:#0c0c0e;border:1px solid #232329;border-radius:12px;padding:15px 16px}
.wf-pri-head{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#8b8b93;margin-bottom:12px}
.wf-pri-tier{margin-bottom:12px}
.wf-pri-tier:last-child{margin-bottom:0}
.wf-pri-tlabel{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#6b6b73;margin-bottom:6px}
.wf-pri-row{display:flex;align-items:baseline;gap:9px;padding:3px 0}
.wf-pri-glyph{font-weight:800;font-size:13px;line-height:1.4;flex:none;width:14px}
.wf-pri-line{font-size:13px;color:#d4d4d8;line-height:1.45}
.wf-pri-met .wf-pri-glyph{color:#10b981}
.wf-pri-partial .wf-pri-glyph{color:#f59e0b}
.wf-pri-unmet .wf-pri-glyph{color:#71717a}
.wf-pri-unmet .wf-pri-line{color:#a1a1aa}
/* Top tier reads a touch stronger; secondary/nice progressively quieter. */
.wf-pri-top .wf-pri-line{font-size:13.5px;color:#e4e4e7}
.wf-pri-secondary .wf-pri-line{font-size:12.5px}
.wf-pri-nice .wf-pri-tlabel,.wf-pri-nice .wf-pri-line{font-size:12px;color:#8b8b93}
/* Missed-top-priority trade-off — tappable; expands to show alt card detail. */
.wf-pri-alt{background:#0c0c0e;border:1px solid #232329;border-left:2px solid #f59e0b;border-radius:10px;overflow:hidden}
.wf-alt-header{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;width:100%;background:none;border:none;padding:12px 14px;cursor:pointer;font-family:'DM Sans',system-ui,sans-serif;text-align:left}
.wf-alt-header:hover{background:rgba(245,158,11,.04)}
.wf-alt-header-text{font-size:12.5px;color:#c4c4c8;line-height:1.5;flex:1}
.wf-alt-header-text b{color:#e4e4e7;font-weight:700}
.wf-alt-chev{font-size:15px;color:#71717a;flex-shrink:0;transition:transform .2s;line-height:1.3;margin-top:1px}
.wf-alt-chev.open{transform:rotate(180deg)}
.wf-alt-card{border-top:1px solid #232329;padding:12px 14px}
.wf-res-runners{display:flex;flex-direction:column;gap:7px}
.wf-runner{display:flex;justify-content:space-between;align-items:center;background:#0e0e11;border:1px solid #2a2a30;border-radius:11px;padding:13px 15px}
.wf-runner-name{font-size:14px;font-weight:600;color:#fafafa;display:flex;align-items:center;gap:7px}
.wf-runner-inv{font-size:9px;font-weight:700;text-transform:uppercase;color:#a78bfa;border:1px solid #3b2f63;border-radius:4px;padding:1px 5px}
.wf-runner-why{font-size:11px;color:#8b8b93;margin-top:2px}
.wf-runner-net{font-size:15px;font-weight:700;color:#d4d4d8;font-variant-numeric:tabular-nums}
.wf-res-transp{background:#0e0e11;border:1px solid #2a2a30;border-radius:12px;padding:16px;margin-top:6px}
.wf-res-transp-tag{display:block;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#34d399;margin-bottom:10px}
.wf-transp-headline{font-size:15px;font-weight:800;color:#fafafa;margin-bottom:11px}
.wf-transp-rows{display:flex;flex-direction:column;gap:7px}
.wf-transp-row{display:flex;align-items:center;gap:10px;font-size:13px}
.wf-tr-mark{font-weight:800;font-size:13px}
.wf-tr-ok .wf-tr-mark{color:#10b981}
.wf-tr-x{color:#71717a}
.wf-tr-n{font-weight:800;color:#fafafa;font-variant-numeric:tabular-nums;min-width:22px}
.wf-tr-label{color:#a1a1aa}
.wf-tr-ok .wf-tr-label{color:#d4d4d8}
.wf-transp-foot{margin-top:12px;padding-top:11px;border-top:1px solid #27272a;font-size:12.5px;color:#a1a1aa;line-height:1.5}
.wf-res-credit{background:#1c1606;border:1px solid #6b5410;border-radius:11px;padding:11px 14px;font-size:12.5px;color:#fbbf24;line-height:1.5}
.wf-res-apr{margin-top:8px}
.wf-fold{background:#0c0c0e;border:1px solid #1f1f23;border-radius:12px;overflow:hidden}
.wf-fold>summary{list-style:none;cursor:pointer;padding:14px 16px;font-size:13px;font-weight:600;color:#a1a1aa;
  display:flex;align-items:center;justify-content:space-between;transition:.12s;user-select:none}
.wf-fold>summary::-webkit-details-marker{display:none}
.wf-fold>summary:hover{color:#e4e4e7}
.wf-fold>summary:after{content:'⌄';font-size:16px;color:#52525b;transition:transform .2s}
.wf-fold[open]>summary:after{transform:rotate(180deg)}
.wf-fold[open]>summary{border-bottom:1px solid #1f1f23}
.wf-fold>*:not(summary){padding:14px 16px}
.wf-fold .wf-res-runners{padding:0}
.wf-fold .wf-res-transp{background:transparent;border:none;border-radius:0;padding:14px 16px}
.wf-fold .wf-res-apr{padding:14px 16px}
.wf-fold .wf-res-apr .wf-apr{border:none;background:transparent;padding:0}
.wf-res-nav{display:flex;gap:8px;margin-top:6px}
/* Back is the primary go-tweak-inputs action; Start over is the destructive secondary. Equal width,
   Back reads at least as prominent (brighter text/border) so it doesn't feel subordinate. */
.wf-res-back{flex:1;background:#1c1c20;border:1px solid #3f3f46;color:#fafafa;font-family:inherit;font-size:13px;font-weight:700;padding:11px;border-radius:10px;cursor:pointer}
.wf-res-restart{flex:1;background:#141417;border:1px solid #2a2a30;color:#a1a1aa;font-family:inherit;font-size:13px;font-weight:600;padding:11px;border-radius:10px;cursor:pointer}
`;

export default ResultsScreen;
