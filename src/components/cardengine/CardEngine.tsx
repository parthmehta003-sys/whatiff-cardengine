/**
 * CardEngine.tsx — the shell. Orchestrates the full flow and is the single integration point
 * with the engine (loadCardDB + recommendNewCard / reviewOwnedCards).
 *
 * Journey B: journey → spend → profile → priorities → results
 * Journey A: journey → owned cards → spend → profile → priorities → results
 *
 * Step order matches the spec (Journey A puts owned cards first). Inputs accumulate in state;
 * results are computed once at the end from the frozen engine.
 */
import React, { useMemo, useState } from 'react';
import type { LoadedCardDB } from '../../lib/cardEngine/loadCardDB';
import {
  recommendNewCard, reviewOwnedCards,
  type Journey, type UserInput, type Priorities, type RankResult,
} from '../../lib/cardEngine/rankCards';
import type { MonthlySpend } from '../../lib/cardEngine/computeEarn';
import type { DevaluationFlag } from './RecommendationCard';
import { selectHackForCard, surfaceInsights, cardIntelligence, type SelectedHack } from '../../lib/cardEngine/selectHacks';
import type { TransferHack, TransferPartner } from '../../lib/cardEngine/loadCardDB';
import { buildCardNarrative, type CardNarrative } from '../../lib/cardEngine/cardNarrative';
import { findAlternativeForMissedTop, type AlternativeForPriority } from '../../lib/cardEngine/evaluatePriorities';

import JourneySelector from './JourneySelector';
import OwnedCardSelector from './OwnedCardSelector';
import SpendInput from './SpendInput';
import ProfileInput, { ProfileValues } from './ProfileInput';
import PrioritySelector from './PrioritySelector';
import ResultsScreen from './ResultsScreen';
import ResultsScreenV2 from './ResultsScreenV2';
import ProsConsDetail from './ProsConsDetail';
import CardTileGallery from './CardTileGallery';
import ChoicesPanel from './ChoicesPanel';

export type Step = 'journey' | 'owned' | 'spend' | 'profile' | 'priorities' | 'results';

interface Props { db: LoadedCardDB; }

export const CardEngine: React.FC<Props> = ({ db }) => {
  const [step, setStep] = useState<Step>('journey');
  const [journey, setJourney] = useState<Journey>('new_card');
  const [journeyChosen, setJourneyChosen] = useState(false);
  const [ownedIds, setOwnedIds] = useState<string[]>([]);
  const [spend, setSpend] = useState<MonthlySpend>({});
  const [profile, setProfile] = useState<ProfileValues | null>(null);
  const [priorities, setPriorities] = useState<Priorities>({});
  const [knowMoreCardId, setKnowMoreCardId] = useState<string | null>(null);

  // Build per-card devaluation flags from DISCONTINUED_WARNINGS (e.g. W013 Sony LIV → CC40).
  const devaluations = useMemo(() => {
    const map: Record<string, DevaluationFlag> = {};
    for (const w of db.warnings) {
      if (!w.affectedCardIds) continue;
      for (const cid of w.affectedCardIds.split(/[,\s]+/).filter(Boolean)) {
        map[cid] = {
          whatChanged: w.whatChanged ?? w.whatUserShouldKnow ?? 'A benefit on this card changed.',
          marketingClaim: w.severity === 'important' ? 'Marketing may still show the old benefit' : undefined,
        };
      }
    }
    return map;
  }, [db.warnings]);

  const liquidity = useMemo(() => {
    const m = new Map<string, { aprAnnualPct: number | null; emiConversionAprPct: number | null }>();
    for (const [k, v] of db.liquidity) m.set(k, { aprAnnualPct: v.aprAnnualPct, emiConversionAprPct: v.emiConversionAprPct });
    return m;
  }, [db.liquidity]);

  const result: RankResult | null = useMemo(() => {
    if (step !== 'results' || !profile) return null;
    const user: UserInput = {
      monthlySpend: spend,
      inHandMonthlyIncome: profile.inHandMonthlyIncome,
      employmentType: profile.employmentType,
      feeTolerance: profile.feeTolerance,
      priorities,
      creditScore: profile.creditScore,
    };
    return journey === 'owns_cards'
      ? reviewOwnedCards(db.cards, ownedIds, db.earnByCard, db.strengths, user)
      : recommendNewCard(db.cards, db.earnByCard, db.strengths, user);
  }, [step, profile, spend, priorities, journey, ownedIds, db]);

  const restart = () => {
    setStep('journey'); setJourneyChosen(false); setOwnedIds([]); setSpend({}); setProfile(null); setPriorities({});
  };

  // Alt card for missed top priority — computed once here so memo loops can include it.
  const altForTop = useMemo((): AlternativeForPriority | null => {
    if (!result) return null;
    const journeyA = result.journey === 'owns_cards';
    const comboHero = !journeyA && !!result.combo;
    const heroNet = comboHero ? result.combo!.netPerYear : (result.recommended[0]?.netGuaranteedPerYear ?? 0);
    return findAlternativeForMissedTop(priorities, result.ranked, result.recommended, heroNet, spend);
  }, [result, priorities, spend]);

  // Stable primitive dep for the three memo loops — avoids a fresh-object-every-render in deps.
  const altCardId = altForTop?.card.cardId ?? null;

  // Hacks, insights, and the Journey-B "leaving on the table" baseline — derived from the result.
  const totalMonthly = Object.values(spend).reduce((s, v) => s + (v ?? 0), 0);
  const hacks = useMemo(() => {
    if (!result) return {};
    const map: Record<string, SelectedHack | null> = {};
    const cards = [...result.recommended];
    if (altCardId) {
      const altCard = result.ranked.find((c) => c.cardId === altCardId);
      if (altCard && !result.recommended.some((c) => c.cardId === altCardId)) cards.push(altCard);
    }
    // Also include owned cards so Phase 1 panels can show their hacks.
    for (const v of result.ownedVerdicts ?? []) {
      if (!cards.some(c => c.cardId === v.cardId)) {
        map[v.cardId] = selectHackForCard(v.cardId, db.hacks, db.warnings, spend, totalMonthly);
      }
    }
    for (const c of cards) {
      map[c.cardId] = selectHackForCard(c.cardId, db.hacks, db.warnings, spend, totalMonthly);
    }
    return map;
  }, [result, altCardId, db.hacks, db.warnings, spend, totalMonthly]);

  const insights = useMemo(
    () => (result ? surfaceInsights(db.insights, spend, priorities) : []),
    [result, db.insights, spend, priorities]
  );

  const intelligence = useMemo(() => {
    if (!result) return {};
    const map: Record<string, { type: string; text: string; severity?: string | null }[]> = {};
    const cards = [...result.recommended];
    if (altCardId) {
      const altCard = result.ranked.find((c) => c.cardId === altCardId);
      if (altCard && !result.recommended.some((c) => c.cardId === altCardId)) cards.push(altCard);
    }
    for (const c of cards) {
      // Recommended / alternative cards → the user is CONSIDERING them.
      const items = cardIntelligence(c.cardId, db.warnings, db.intelligence, c.meta.name, 'user_considers_card');
      if (items.length) map[c.cardId] = items;
    }
    // Also compute intelligence for owned cards (Journey A) — they were previously excluded,
    // causing "Things to know" to always show "No current alerts" for held cards.
    for (const v of result.ownedVerdicts ?? []) {
      if (map[v.cardId] !== undefined) continue; // already computed (card is also recommended)
      // Owned cards → the user OWNS them.
      const items = cardIntelligence(v.cardId, db.warnings, db.intelligence, v.cardName, 'user_owns_card');
      if (items.length) map[v.cardId] = items;
    }
    return map;
  }, [result, altCardId, db.warnings, db.intelligence]);

  const narratives = useMemo(() => {
    if (!result) return {};
    const map: Record<string, CardNarrative> = {};
    const cards = [...result.recommended];
    if (altCardId) {
      const altCard = result.ranked.find((c) => c.cardId === altCardId);
      if (altCard && !result.recommended.some((c) => c.cardId === altCardId)) cards.push(altCard);
    }
    for (const c of cards) {
      map[c.cardId] = buildCardNarrative(c.meta, c.earn, spend, c.effectiveAnnualFee);
    }
    return map;
  }, [result, altCardId, spend]);

  // Transfer hacks and partners — keyed by cardId for fast lookup in ResultsScreenV2.
  const transferHacksMap = useMemo(() => {
    const map: Record<string, TransferHack> = {};
    for (const h of db.transferHacks) map[h.cardId] = h;
    return map;
  }, [db.transferHacks]);

  const transferPartnersMap = useMemo(() => {
    const map: Record<string, TransferPartner[]> = {};
    for (const p of db.transferPartners) {
      if (!map[p.cardId]) map[p.cardId] = [];
      map[p.cardId].push(p);
    }
    return map;
  }, [db.transferPartners]);

  // baseline = median net across eligible cards (Journey B only), for the "on the table" line.
  const baselineNet = useMemo(() => {
    if (!result || result.journey !== 'new_card') return undefined;
    const nets = result.ranked.map((c) => c.netGuaranteedPerYear).filter((n) => n > 0).sort((a, b) => a - b);
    if (nets.length < 3) return undefined;
    return nets[Math.floor(nets.length / 2)];
  }, [result]);

  // DEV-ONLY: tile verification gallery, gated behind the #tiles hash. Remove once verified.
  if (typeof window !== 'undefined' && window.location.hash === '#tiles') {
    return <CardTileGallery cards={db.cards} />;
  }

  // Default results screen is V2. Append ?v1 to any URL to view the old ResultsScreen (escape hatch).
  const useLegacy = typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search.toLowerCase()).has('v1');

  return (
    <div className="wf-shell">
      <style>{shellCss}</style>
      <div className="wf-layout">
        <ChoicesPanel
          step={step} journey={journey} ownedIds={ownedIds}
          spend={spend} profile={profile} priorities={priorities}
          setStep={setStep}
        />
        <div className="wf-main">
          <StepBar step={step} journey={journey} />
          <div className="wf-shell-body">
            {step === 'journey' && (
              <JourneySelector
                selectedJourney={journeyChosen ? journey : undefined}
                onSelect={(j) => { setJourney(j); setJourneyChosen(true); setStep(j === 'owns_cards' ? 'owned' : 'spend'); }}
              />
            )}
            {step === 'owned' && (
              <OwnedCardSelector
                cards={db.cards} initial={ownedIds}
                onBack={() => setStep('journey')}
                onContinue={(ids) => { setOwnedIds(ids); setStep('spend'); }}
              />
            )}
            {step === 'spend' && (
              <SpendInput
                initial={spend}
                monthlyIncome={profile?.inHandMonthlyIncome}
                onBack={() => setStep(journey === 'owns_cards' ? 'owned' : 'journey')}
                onContinue={(s) => { setSpend(s); setStep('profile'); }}
              />
            )}
            {step === 'profile' && (
              <ProfileInput
                initial={profile ?? undefined}
                onBack={() => setStep('spend')}
                onContinue={(p) => { setProfile(p); setStep('priorities'); }}
              />
            )}
            {step === 'priorities' && (
              <PrioritySelector
                initial={priorities}
                onBack={() => setStep('profile')}
                onSkip={() => { setPriorities({}); setStep('results'); }}
                onContinue={(p) => { setPriorities(p); setStep('results'); }}
              />
            )}
            {step === 'results' && result && (useLegacy ? (
              <ResultsScreen
                result={result}
                monthlySpend={spend}
                isTravelPriority={priorities.top === 'Travel' || priorities.top === 'Lounge'}
                devaluations={devaluations}
                hacks={hacks}
                insights={insights}
                intelligence={intelligence}
                narratives={narratives}
                onKnowMore={(cardId) => setKnowMoreCardId(cardId)}
                baselineNet={baselineNet}
                liquidity={liquidity}
                priorities={priorities}
                altForTop={altForTop}
                onBack={() => setStep('priorities')}
                onRestart={restart}
              />
            ) : (
              <ResultsScreenV2
                result={result}
                monthlySpend={spend}
                isTravelPriority={priorities.top === 'Travel' || priorities.top === 'Lounge'}
                devaluations={devaluations}
                hacks={hacks}
                insights={insights}
                intelligence={intelligence}
                narratives={narratives}
                onKnowMore={(cardId) => setKnowMoreCardId(cardId)}
                baselineNet={baselineNet}
                liquidity={liquidity}
                priorities={priorities}
                altForTop={altForTop}
                transferHacks={transferHacksMap}
                transferPartners={transferPartnersMap}
                onBack={() => setStep('priorities')}
                onRestart={restart}
              />
            ))}
          </div>
        </div>{/* wf-main */}
      </div>{/* wf-layout */}

      {knowMoreCardId && (() => {
        const c = db.cardById.get(knowMoreCardId);
        return c ? (
          <ProsConsDetail
            cardName={c.name}
            rawPros={c.pros ?? null}
            rawCons={c.cons ?? null}
            onClose={() => setKnowMoreCardId(null)}
          />
        ) : null;
      })()}
    </div>
  );
};

const StepBar: React.FC<{ step: Step; journey: Journey }> = ({ step, journey }) => {
  const steps: Step[] = journey === 'owns_cards'
    ? ['owned', 'spend', 'profile', 'priorities', 'results']
    : ['spend', 'profile', 'priorities', 'results'];
  if (step === 'journey') return null;
  const idx = steps.indexOf(step);
  return (
    <div className="wf-stepbar">
      {steps.map((s, i) => (
        <div key={s} className={'wf-stepdot' + (i <= idx ? ' on' : '')} />
      ))}
    </div>
  );
};

const shellCss = `
.wf-shell{font-family:'DM Sans',system-ui,sans-serif;background:#000;min-height:100vh;padding:28px 16px 60px}
.wf-layout{display:flex;gap:32px;max-width:940px;margin:0 auto;align-items:flex-start}
.wf-main{flex:1;min-width:0}
.wf-stepbar{display:flex;gap:6px;justify-content:center;max-width:560px;margin:0 auto 26px}
.wf-stepdot{height:3px;flex:1;max-width:60px;background:#27272a;border-radius:2px;transition:background .3s}
.wf-stepdot.on{background:#10b981}
.wf-shell-body{animation:wf-fade .25s ease}
@keyframes wf-fade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
`;

export default CardEngine;
