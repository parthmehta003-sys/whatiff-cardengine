/**
 * ChoicesPanel — persistent "your choices so far" panel.
 * Desktop: sticky left sidebar (220px). Mobile (<900px): hidden; a pill button opens a slide-in drawer.
 * Hidden on 'journey' (nothing chosen) and 'results' (full width needed).
 * Tapping a section heading or item jumps back to that step; forward navigation is never allowed.
 */
import React, { useState } from 'react';
import type { MonthlySpend } from '../../lib/cardEngine/computeEarn';
import type { Journey, Priorities } from '../../lib/cardEngine/rankCards';
import type { ProfileValues } from './ProfileInput';

export type Step = 'journey' | 'owned' | 'spend' | 'profile' | 'priorities' | 'results';

const STEP_ORDER_NEW: Step[]   = ['journey', 'spend', 'profile', 'priorities', 'results'];
const STEP_ORDER_OWNED: Step[] = ['journey', 'owned', 'spend', 'profile', 'priorities', 'results'];

const CAT_SHORT: Record<string, string> = {
  Online: 'Online', Dining: 'Dining', Grocery: 'Grocery', Fuel: 'Fuel',
  Travel: 'Travel', Utility: 'Utility', Subscriptions: 'Subs', International: 'Intl',
};

const FEE_LABEL: Record<string, string> = {
  ltf_only:   'Free',
  upto_500:   'Up to ₹500',
  upto_1000:  'Up to ₹1,000',
  upto_5000:  '₹1,000–₹5,000',
  above_5000: '₹5,000+',
};

const EMP_LABEL: Record<string, string> = {
  salaried:      'Salaried',
  self_employed: 'Self-employed',
};

const inrK = (n: number) => n >= 1000 ? `₹${Math.round(n / 1000)}k` : `₹${n}`;

interface Props {
  step: Step;
  journey: Journey;
  ownedIds: string[];
  spend: MonthlySpend;
  profile: ProfileValues | null;
  priorities: Priorities;
  setStep: (s: Step) => void;
}

export const ChoicesPanel: React.FC<Props> = ({
  step, journey, ownedIds, spend, profile, priorities, setStep,
}) => {
  const [drawerOpen, setDrawerOpen] = useState(false);

  const hidden = step === 'journey';
  if (hidden) return null;

  const isResults = step === 'results';

  const order = journey === 'owns_cards' ? STEP_ORDER_OWNED : STEP_ORDER_NEW;
  const currentIdx = order.indexOf(step);
  // On results every input step is "past", so all sections are editable.
  const pastStep = (s: Step) => order.indexOf(s) < currentIdx;

  const jumpTo = (s: Step) => {
    if (!pastStep(s)) return;
    setStep(s);
    setDrawerOpen(false);
  };

  const spendItems = Object.entries(spend)
    .filter(([, v]) => (v ?? 0) > 0)
    .map(([k, v]) => `${CAT_SHORT[k] ?? k} ${inrK(v ?? 0)}`);

  const content = (
    <div className="wf-cp-inner">
      <div className="wf-cp-label">Your choices</div>

      {/* Journey */}
      <section className="wf-cp-section">
        <button
          className="wf-cp-heading"
          onClick={() => jumpTo('journey')}
          disabled={!pastStep('journey')}
        >
          Journey {pastStep('journey') && <span className="wf-cp-edit">edit</span>}
        </button>
        <div className="wf-cp-val">
          {journey === 'owns_cards' ? 'Review my cards' : 'Find a new card'}
        </div>
      </section>

      {/* Owned cards — Journey A only */}
      {journey === 'owns_cards' && pastStep('owned') && (
        <section className="wf-cp-section">
          <button
            className="wf-cp-heading"
            onClick={() => jumpTo('owned')}
            disabled={!pastStep('owned')}
          >
            My cards {pastStep('owned') && <span className="wf-cp-edit">edit</span>}
          </button>
          <div className="wf-cp-val">
            {ownedIds.length === 0
              ? <span className="wf-cp-muted">None selected</span>
              : `${ownedIds.length} card${ownedIds.length > 1 ? 's' : ''}`}
          </div>
        </section>
      )}

      {/* Spend */}
      {pastStep('spend') && spendItems.length > 0 && (
        <section className="wf-cp-section">
          <button
            className="wf-cp-heading"
            onClick={() => jumpTo('spend')}
            disabled={!pastStep('spend')}
          >
            Spend {pastStep('spend') && <span className="wf-cp-edit">edit</span>}
          </button>
          <div className="wf-cp-spend">
            {spendItems.map((s, i) => <div key={i} className="wf-cp-val">{s}</div>)}
          </div>
        </section>
      )}

      {/* Profile */}
      {pastStep('profile') && profile !== null && (
        <section className="wf-cp-section">
          <button
            className="wf-cp-heading"
            onClick={() => jumpTo('profile')}
            disabled={!pastStep('profile')}
          >
            Profile {pastStep('profile') && <span className="wf-cp-edit">edit</span>}
          </button>
          <div className="wf-cp-val">{inrK(profile.inHandMonthlyIncome)}/mo</div>
          <div className="wf-cp-val">{EMP_LABEL[profile.employmentType] ?? profile.employmentType}</div>
          <div className="wf-cp-val">{FEE_LABEL[profile.feeTolerance] ?? profile.feeTolerance}</div>
          {profile.creditScore != null && (
            <div className="wf-cp-val">Score {profile.creditScore}</div>
          )}
        </section>
      )}

      {/* Priorities */}
      {pastStep('priorities') && (
        <section className="wf-cp-section">
          <button
            className="wf-cp-heading"
            onClick={() => jumpTo('priorities')}
            disabled={!pastStep('priorities')}
          >
            Priorities {pastStep('priorities') && <span className="wf-cp-edit">edit</span>}
          </button>
          {priorities.top || priorities.secondary || priorities.niceToHave ? (
            <>
              {priorities.top       && <div className="wf-cp-val"><span className="wf-cp-tier">Top</span> {priorities.top}</div>}
              {priorities.secondary && <div className="wf-cp-val"><span className="wf-cp-tier">2nd</span> {priorities.secondary}</div>}
              {priorities.niceToHave && <div className="wf-cp-val"><span className="wf-cp-tier">Nice</span> {priorities.niceToHave}</div>}
            </>
          ) : (
            <div className="wf-cp-val wf-cp-muted">Skipped</div>
          )}
        </section>
      )}
    </div>
  );

  return (
    <div className={isResults ? 'wf-cp--results' : undefined}>
      <style>{css}</style>

      {/* Desktop sidebar (hidden on results via .wf-cp--results) */}
      <aside className="wf-cp-sidebar">
        {content}
      </aside>

      {/* Mobile pill + drawer (always shown on results, including desktop) */}
      <button
        className="wf-cp-pill"
        onClick={() => setDrawerOpen(true)}
        aria-label="Your choices"
      >
        Your choices ↑
      </button>

      {drawerOpen && (
        <div className="wf-cp-overlay" onClick={() => setDrawerOpen(false)}>
          <div className="wf-cp-drawer" onClick={(e) => e.stopPropagation()}>
            <button className="wf-cp-close" onClick={() => setDrawerOpen(false)}>✕</button>
            {content}
          </div>
        </div>
      )}
    </div>
  );
};

const css = `
/* Desktop sidebar */
.wf-cp-sidebar{
  width:220px;flex:0 0 220px;position:sticky;top:28px;
  display:none; /* shown via media query below */
}
@media(min-width:900px){
  .wf-cp-sidebar{display:block}
  .wf-cp-pill{display:none!important}
}

/* Shared inner panel */
.wf-cp-inner{
  background:#0a0a0c;border:1px solid #1a1a1e;border-radius:14px;
  padding:16px 14px;display:flex;flex-direction:column;gap:2px;
}
.wf-cp-label{
  font-family:'DM Sans',system-ui,sans-serif;
  font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;
  color:#3f3f46;margin-bottom:8px;
}
.wf-cp-section{display:flex;flex-direction:column;gap:2px;margin-bottom:10px}
.wf-cp-section:last-child{margin-bottom:0}
.wf-cp-heading{
  display:flex;align-items:center;justify-content:space-between;
  background:none;border:none;padding:0;cursor:pointer;
  font-family:'DM Sans',system-ui,sans-serif;font-size:11px;font-weight:700;
  color:#52525b;text-align:left;transition:color .12s;margin-bottom:2px;
}
.wf-cp-heading:not(:disabled):hover{color:#a1a1aa}
.wf-cp-heading:disabled{cursor:default}
.wf-cp-edit{
  font-size:9.5px;font-weight:600;color:#3f3f46;letter-spacing:.03em;
  text-transform:uppercase;transition:color .12s;
}
.wf-cp-heading:not(:disabled):hover .wf-cp-edit{color:#71717a}
.wf-cp-val{
  font-family:'DM Sans',system-ui,sans-serif;
  font-size:12px;font-weight:500;color:#71717a;line-height:1.5;
}
.wf-cp-spend{display:flex;flex-direction:column;gap:1px}
.wf-cp-muted{color:#3f3f46}
.wf-cp-tier{
  font-size:9px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;
  color:#3f3f46;margin-right:4px;
}

/* Mobile pill */
.wf-cp-pill{
  position:fixed;bottom:24px;right:20px;z-index:40;
  background:#18181b;border:1px solid #27272a;color:#a1a1aa;
  font-family:'DM Sans',system-ui,sans-serif;font-size:13px;font-weight:600;
  padding:10px 16px;border-radius:100px;cursor:pointer;
  box-shadow:0 4px 20px rgba(0,0,0,.6);transition:.15s;
}
.wf-cp-pill:hover{background:#1f1f23;border-color:#3f3f46;color:#e4e4e7}

/* Overlay + drawer */
.wf-cp-overlay{
  position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.6);
  display:flex;justify-content:flex-end;
  animation:wf-overlay-in .18s ease;
}
@keyframes wf-overlay-in{from{opacity:0}to{opacity:1}}
.wf-cp-drawer{
  width:80vw;max-width:320px;height:100%;background:#09090b;
  border-left:1px solid #1f1f23;padding:24px 16px;overflow-y:auto;
  display:flex;flex-direction:column;
  animation:wf-drawer-in .2s ease;
}
@keyframes wf-drawer-in{from{transform:translateX(100%)}to{transform:translateX(0)}}
.wf-cp-close{
  align-self:flex-end;background:none;border:none;color:#52525b;
  font-size:16px;cursor:pointer;padding:4px 8px;margin-bottom:12px;
  transition:color .12s;
}
.wf-cp-close:hover{color:#a1a1aa}

/* Results: hide sidebar, always show pill (override desktop media query) */
.wf-cp--results .wf-cp-sidebar{display:none!important}
@media(min-width:900px){.wf-cp--results .wf-cp-pill{display:flex!important}}
`;

export default ChoicesPanel;
