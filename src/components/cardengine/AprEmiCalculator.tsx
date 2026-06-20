/**
 * AprEmiCalculator.tsx — the "cost of carrying a balance" tool (Spec §9 + Addendum C1).
 *
 * Sits BELOW recommendations, decoupled. Anti-bank-marketing framing: shows what revolving or
 * EMI actually costs so the user can AVOID it. All math from aprMath.ts (pure). This component
 * formats + drives inputs; it computes nothing itself.
 *
 * C1 CONTRACT (locked): when a rate is a default/estimate (card has no stored rate, or the rate
 * was clamped as a data artifact), it MUST be shown as visibly editable — never silently applied.
 * `effectiveAprUsed` from aprMath tells us the rate actually used.
 *
 * Styling: WhatIff tokens — dark zinc (#09090b), DM Sans, BORROW=purple accent (#8b5cf6).
 */

import React, { useMemo, useState } from 'react';
import {
  simulateRevolving, computeEmi,
  DEFAULT_APR_ANNUAL_PCT, DEFAULT_EMI_APR_ANNUAL_PCT, DEFAULT_MIN_DUE_PCT,
} from '../../lib/cardEngine/aprMath';

const inr = (n: number) =>
  !Number.isFinite(n) ? '∞' : '₹' + Math.round(n).toLocaleString('en-IN');

type Mode = 'revolving' | 'emi';

interface Props {
  cardName?: string;
  /** Stored card APR if known (null → estimate). Drives the C1 "estimated (change)" label. */
  storedAprAnnualPct?: number | null;
  storedEmiAprAnnualPct?: number | null; // DB has none today → always estimate
}

export const AprEmiCalculator: React.FC<Props> = ({
  cardName, storedAprAnnualPct, storedEmiAprAnnualPct,
}) => {
  const [mode, setMode] = useState<Mode>('revolving');

  // Revolving state
  const [outstanding, setOutstanding] = useState(50000);
  const [aprEdited, setAprEdited] = useState<number | null>(null);
  const [payStrategy, setPayStrategy] = useState<'min' | 'fixed'>('min');
  const [fixedPayment, setFixedPayment] = useState(5000);

  // EMI state
  const [principal, setPrincipal] = useState(50000);
  const [tenure, setTenure] = useState(6);
  const [emiAprEdited, setEmiAprEdited] = useState<number | null>(null);

  // resolve the APR actually used + whether it's an estimate (C1)
  const revAprIsEstimate = aprEdited == null && (storedAprAnnualPct == null || storedAprAnnualPct < 5);
  const revApr = aprEdited ?? (storedAprAnnualPct && storedAprAnnualPct >= 5 ? storedAprAnnualPct : DEFAULT_APR_ANNUAL_PCT);

  const emiAprIsEstimate = emiAprEdited == null && (storedEmiAprAnnualPct == null || storedEmiAprAnnualPct < 5);
  const emiApr = emiAprEdited ?? (storedEmiAprAnnualPct && storedEmiAprAnnualPct >= 5 ? storedEmiAprAnnualPct : DEFAULT_EMI_APR_ANNUAL_PCT);

  const rev = useMemo(() => simulateRevolving({
    outstanding,
    aprAnnualPct: revApr,
    monthlyPayment: payStrategy === 'fixed' ? fixedPayment : undefined,
    minDuePct: DEFAULT_MIN_DUE_PCT,
    applyGstOnInterest: true,
  }), [outstanding, revApr, payStrategy, fixedPayment]);

  const emi = useMemo(() => computeEmi({
    principal, tenureMonths: tenure, emiAprAnnualPct: emiApr, applyGst: true,
  }), [principal, tenure, emiApr]);

  return (
    <div className="wf-apr">
      <style>{css}</style>

      <div className="wf-apr-head">
        <div>
          <div className="wf-apr-title">What unpaid card money costs you</div>
          <div className="wf-apr-sub">
            {cardName ? cardName + ' · ' : ''}see the real cost of not paying in full — so you can avoid it
          </div>
        </div>
      </div>

      <div className="wf-apr-tabs">
        <button className={mode === 'revolving' ? 'on' : ''} onClick={() => setMode('revolving')}>
          If you pay the minimum
        </button>
        <button className={mode === 'emi' ? 'on' : ''} onClick={() => setMode('emi')}>
          If you convert to EMI
        </button>
      </div>

      {mode === 'revolving' ? (
        <>
          <Field label="Amount left unpaid">
            <Money value={outstanding} onChange={setOutstanding} />
          </Field>

          <RateField
            label="Interest rate on your card"
            value={revApr}
            isEstimate={revAprIsEstimate}
            onChange={(v) => setAprEdited(v)}
          />

          <Field label="How will you pay it back?">
            <div className="wf-seg">
              <button className={payStrategy === 'min' ? 'on' : ''} onClick={() => setPayStrategy('min')}>
                Only the minimum
              </button>
              <button className={payStrategy === 'fixed' ? 'on' : ''} onClick={() => setPayStrategy('fixed')}>
                A fixed amount
              </button>
            </div>
          </Field>
          {payStrategy === 'fixed' && (
            <Field label="How much per month">
              <Money value={fixedPayment} onChange={setFixedPayment} />
            </Field>
          )}

          <div className="wf-apr-out">
            {rev.neverClears ? (
              <div className="wf-apr-never">
                <div className="wf-apr-never-big">Paying this little, it never clears</div>
                <div className="wf-apr-never-sub">{rev.caveat}</div>
              </div>
            ) : (
              <>
                <Stat label="Extra you pay as interest" value={inr(rev.totalInterest)} danger />
                <Stat label="How long to clear it" value={rev.monthsToClear + ' months'} />
                <Stat label="Total you pay in the end" value={inr(rev.totalPaid)} sub={`on ${inr(outstanding)} unpaid`} />
              </>
            )}
          </div>
          <div className="wf-apr-caveat">{rev.caveat}</div>
        </>
      ) : (
        <>
          <Field label="Amount to convert to EMI">
            <Money value={principal} onChange={setPrincipal} />
          </Field>
          <Field label="Tenure">
            <div className="wf-seg">
              {[3, 6, 9, 12, 24].map((t) => (
                <button key={t} className={tenure === t ? 'on' : ''} onClick={() => setTenure(t)}>{t}m</button>
              ))}
            </div>
          </Field>
          <RateField
            label="EMI interest rate"
            value={emiApr}
            isEstimate={emiAprIsEstimate}
            onChange={(v) => setEmiAprEdited(v)}
          />

          <div className="wf-apr-out">
            <Stat label="Monthly EMI" value={inr(emi.monthlyEmi)} />
            <Stat label="Extra you pay as interest" value={inr(emi.totalInterest)} danger />
            <Stat label="One-time processing fee" value={inr(emi.processingFee)} />
            <Stat label="Extra cost vs paying it all now" value={inr(emi.costOverPayingInFull)} danger
              sub="what spreading it out costs you" />
          </div>
          <div className="wf-apr-caveat">{emi.caveat}</div>
        </>
      )}
    </div>
  );
};

// ── sub-components ──
const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="wf-field">
    <label>{label}</label>
    {children}
  </div>
);

const Money: React.FC<{ value: number; onChange: (n: number) => void }> = ({ value, onChange }) => (
  <div className="wf-money">
    <span>₹</span>
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(Math.max(0, parseInt(e.target.value || '0', 10)))}
    />
  </div>
);

/** Rate input that honors the C1 contract: shows "estimated (change)" when not user-set. */
const RateField: React.FC<{
  label: string; value: number; isEstimate: boolean; onChange: (n: number) => void;
}> = ({ label, value, isEstimate, onChange }) => {
  const [editing, setEditing] = useState(false);
  return (
    <div className="wf-field">
      <label>{label}</label>
      {editing ? (
        <div className="wf-money">
          <input
            type="number" step="0.5" autoFocus
            value={value}
            onChange={(e) => onChange(parseFloat(e.target.value || '0'))}
            onBlur={() => setEditing(false)}
          />
          <span>%</span>
        </div>
      ) : (
        <div className="wf-rate-disp">
          <span className="wf-rate-num">{value}%</span>
          {isEstimate && <span className="wf-rate-est">estimated</span>}
          <button className="wf-rate-change" onClick={() => setEditing(true)}>change</button>
        </div>
      )}
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string; danger?: boolean; sub?: string }> = ({ label, value, danger, sub }) => (
  <div className="wf-stat">
    <div className="wf-stat-label">{label}</div>
    <div className={'wf-stat-val' + (danger ? ' wf-stat-danger' : '')}>{value}</div>
    {sub && <div className="wf-stat-sub">{sub}</div>}
  </div>
);

const css = `
.wf-apr{font-family:'DM Sans',system-ui,sans-serif;background:#09090b;border:1px solid #1f1f23;
  border-radius:18px;padding:18px;color:#e4e4e7;max-width:560px}
.wf-apr-head{margin-bottom:14px}
.wf-apr-title{font-size:16px;font-weight:700;color:#fafafa;letter-spacing:-.01em}
.wf-apr-sub{font-size:12px;color:#71717a;margin-top:2px}
.wf-apr-tabs{display:flex;gap:6px;background:#111113;border:1px solid #1f1f23;border-radius:10px;
  padding:4px;margin-bottom:16px}
.wf-apr-tabs button{flex:1;background:transparent;border:none;color:#71717a;font-family:inherit;
  font-size:12.5px;font-weight:600;padding:9px;border-radius:7px;cursor:pointer;transition:.15s}
.wf-apr-tabs button.on{background:#8b5cf6;color:#0c0612}
.wf-field{margin-bottom:13px}
.wf-field>label{display:block;font-size:11px;font-weight:600;text-transform:uppercase;
  letter-spacing:.04em;color:#52525b;margin-bottom:6px}
.wf-money{display:flex;align-items:center;gap:6px;background:#111113;border:1px solid #27272a;
  border-radius:9px;padding:0 12px}
.wf-money span{color:#71717a;font-size:14px}
.wf-money input{flex:1;background:transparent;border:none;outline:none;color:#fafafa;
  font-family:inherit;font-size:15px;font-weight:600;padding:11px 0;width:100%}
.wf-money input::-webkit-outer-spin-button,.wf-money input::-webkit-inner-spin-button{-webkit-appearance:none}
.wf-seg{display:flex;gap:6px}
.wf-seg button{flex:1;background:#111113;border:1px solid #27272a;color:#a1a1aa;font-family:inherit;
  font-size:12.5px;font-weight:600;padding:10px;border-radius:8px;cursor:pointer;transition:.15s}
.wf-seg button.on{background:#1c1530;border-color:#8b5cf6;color:#c4b5fd}
.wf-rate-disp{display:flex;align-items:center;gap:10px;background:#111113;border:1px solid #27272a;
  border-radius:9px;padding:11px 12px}
.wf-rate-num{font-size:15px;font-weight:700;color:#fafafa}
.wf-rate-est{font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;
  color:#f59e0b;border:1px solid #5a4410;background:#1c1606;border-radius:4px;padding:2px 6px}
.wf-rate-change{margin-left:auto;background:none;border:none;color:#8b5cf6;font-family:inherit;
  font-size:12px;font-weight:600;cursor:pointer;text-decoration:underline}
.wf-apr-out{margin-top:16px;display:flex;flex-direction:column;gap:1px;background:#1f1f23;
  border-radius:12px;overflow:hidden}
.wf-stat{background:#0c0c0e;padding:13px 15px;display:flex;flex-direction:column}
.wf-stat-label{font-size:11.5px;color:#71717a}
.wf-stat-val{font-size:21px;font-weight:800;color:#fafafa;font-variant-numeric:tabular-nums;
  letter-spacing:-.01em;margin-top:2px}
.wf-stat-danger{color:#f87171}
.wf-stat-sub{font-size:10.5px;color:#52525b;margin-top:1px}
.wf-apr-never{background:#1a0f0f;padding:18px;text-align:center}
.wf-apr-never-big{font-size:18px;font-weight:800;color:#f87171}
.wf-apr-never-sub{font-size:12px;color:#a1a1aa;margin-top:5px;line-height:1.5}
.wf-apr-caveat{margin-top:11px;font-size:11px;color:#52525b;line-height:1.5}
`;

export default AprEmiCalculator;
