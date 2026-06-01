/**
 * ResultsScreen.tsx — the payoff screen. Composes everything from a RankResult:
 * journey-aware recommendations, combo label, Journey-A owned verdicts, runners-up, premium band,
 * transparency block, credit note, and the APR/EMI calculator.
 *
 * All numbers come from the engine via RankResult. Pure presentation.
 */
import React from 'react';
import type { RankResult, RankedCard, CardMeta } from '../../lib/cardEngine/rankCards';
import type { MonthlySpend } from '../../lib/cardEngine/computeEarn';
import RecommendationCard, { DevaluationFlag } from './RecommendationCard';
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
  onRestart?: () => void;
}

export const ResultsScreen: React.FC<Props> = ({
  result, monthlySpend, isTravelPriority, devaluations, hacks, intelligence, narratives, onKnowMore, insights, baselineNet, liquidity, onRestart,
}) => {
  const t = result.transparency;
  const journeyA = result.journey === 'owns_cards';
  const top = result.recommended[0];
  const eligibleCount = t.totalEvaluated - t.failedIncome - t.failedFee;
  const onTable = !journeyA && top && baselineNet != null
    ? Math.round(top.netGuaranteedPerYear - baselineNet) : null;

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
        {journeyA ? 'Cards that would improve your setup' : 'Your top match'}
        <span className="wf-res-shape">{result.spendShape} spend</span>
      </div>

      {/* Journey B "leaving on the table" — the memorable number */}
      {onTable != null && onTable > 0 && (
        <div className="wf-res-ontable">
          <div className="wf-ot-row"><span>{top.meta.name}</span><b>{inr(top.netGuaranteedPerYear)}/yr</b></div>
          <div className="wf-ot-row wf-ot-base"><span>A typical eligible card</span><span>{inr(baselineNet!)}/yr</span></div>
          <div className="wf-ot-punch">You&rsquo;re leaving <b>{inr(onTable)}/year</b> on the table with the wrong card.</div>
        </div>
      )}

      {/* combo label */}
      {result.combo && (
        <div className="wf-res-combo">
          <span className="wf-res-combo-tag">best combo</span>
          {result.combo.label}
        </div>
      )}

      {/* recommended cards */}
      <div className="wf-res-cards">
        {result.recommended.map((c, i) => (
          <RecommendationCard
            key={c.cardId}
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
            } : undefined}
            intelligence={intelligence?.[c.cardId]}
            narrative={narratives?.[c.cardId]}
            onKnowMore={onKnowMore ? () => onKnowMore(c.cardId) : undefined}
          />
        ))}
      </div>

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

      {onRestart && <button className="wf-res-restart" onClick={onRestart}>Start over</button>}
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
.wf-res-ontable{background:#0c0c0e;border:1px solid #2a2a30;border-radius:12px;padding:14px 16px}
.wf-ot-row{display:flex;justify-content:space-between;align-items:baseline;font-size:14px;color:#e4e4e7;margin-bottom:5px}
.wf-ot-row b{color:#10b981;font-weight:800;font-variant-numeric:tabular-nums}
.wf-ot-base{color:#a1a1aa;font-size:13px}
.wf-ot-base span:last-child{font-variant-numeric:tabular-nums}
.wf-ot-punch{margin-top:9px;padding-top:10px;border-top:1px solid #27272a;font-size:14px;color:#fafafa;line-height:1.5}
.wf-ot-punch b{color:#34d399;font-weight:800}
.wf-res-combo{background:#0a1410;border:1px solid #1a6b46;border-radius:12px;padding:13px 15px;font-size:13px;color:#e4e4e7;line-height:1.55}
.wf-res-combo-tag{display:inline-block;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#34d399;border:1px solid #1a6b46;border-radius:4px;padding:2px 6px;margin-right:8px}
.wf-res-cards{display:flex;flex-direction:column;gap:13px}
.wf-res-insights{display:flex;flex-direction:column;gap:8px}
.wf-insight{background:#0c0c0e;border:1px solid #2a2a30;border-radius:11px;padding:11px 14px;font-size:12.5px;color:#d4d4d8;line-height:1.55}
.wf-insight b{color:#fafafa}
.wf-insight-tag{display:inline-block;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#06b6d4;border:1px solid #155e6b;border-radius:4px;padding:1px 6px;margin-right:8px}
.wf-res-flat{background:#0c0c0e;border:1px solid #2a2a30;border-radius:11px;padding:12px 14px;font-size:12.5px;color:#c4c4c8;line-height:1.5}
.wf-res-sub{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#a1a1aa;margin-top:8px}
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
.wf-fold .wf-res-runners,.wf-fold .wf-res-transp,.wf-fold .wf-res-apr{padding:0}
.wf-fold .wf-res-transp{background:transparent;border:none;border-radius:0}
.wf-fold .wf-res-apr .wf-apr{border:none;background:transparent;padding:0}
.wf-res-restart{background:#1c1c20;border:1px solid #2a2a30;color:#c4c4c8;font-family:inherit;font-size:13px;font-weight:600;padding:11px;border-radius:10px;cursor:pointer;margin-top:6px}
`;

export default ResultsScreen;
