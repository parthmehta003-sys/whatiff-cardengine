/**
 * ProfileInput.tsx — eligibility inputs (Spec §4, A4).
 * In-hand monthly income (NOT gross), employment type (salaried/self-employed → minSalary vs minItr),
 * fee tolerance (LTF / ≤1k / ≤5k / any), optional credit score (drives soft disclaimer + external link).
 */
import React, { useState } from 'react';
import type { FeeTolerance, EmploymentType } from '../../lib/cardEngine/rankCards';

export interface ProfileValues {
  inHandMonthlyIncome: number;
  employmentType: EmploymentType;
  feeTolerance: FeeTolerance;
  creditScore?: number;
}

interface Props {
  initial?: Partial<ProfileValues>;
  onContinue: (v: ProfileValues) => void;
  onBack?: () => void;
}

const FEE_OPTS: { key: FeeTolerance; label: string }[] = [
  { key: 'ltf_only', label: 'Lifetime Free only' },
  { key: 'upto_1000', label: 'Up to ₹1,000' },
  { key: 'upto_5000', label: 'Up to ₹5,000' },
  { key: 'any', label: 'Any fee' },
];

export const ProfileInput: React.FC<Props> = ({ initial, onContinue, onBack }) => {
  const [income, setIncome] = useState(initial?.inHandMonthlyIncome ?? 0);
  const [emp, setEmp] = useState<EmploymentType>(initial?.employmentType ?? 'salaried');
  const [fee, setFee] = useState<FeeTolerance>(initial?.feeTolerance ?? 'any');
  const [scoreKnown, setScoreKnown] = useState<boolean | null>(initial?.creditScore != null ? true : null);
  const [score, setScore] = useState(initial?.creditScore ?? 750);

  const valid = income > 0;

  return (
    <div className="wf-pf">
      <style>{css}</style>
      <h2>A bit about you</h2>
      <p className="wf-pf-sub">This decides which cards you&rsquo;re eligible for. Nothing is stored or shared.</p>

      <label className="wf-pf-l">In-hand monthly salary <span>take-home, not gross</span></label>
      <div className="wf-pf-money">
        <span>₹</span>
        <input type="number" inputMode="numeric" placeholder="e.g. 80000"
          value={income || ''} onChange={(e) => setIncome(Math.max(0, parseInt(e.target.value || '0', 10)))} />
        <span className="wf-pf-per">/mo</span>
      </div>

      <label className="wf-pf-l">You are</label>
      <div className="wf-pf-seg">
        <button className={emp === 'salaried' ? 'on' : ''} onClick={() => setEmp('salaried')}>Salaried</button>
        <button className={emp === 'self_employed' ? 'on' : ''} onClick={() => setEmp('self_employed')}>Self-employed</button>
      </div>

      <label className="wf-pf-l">Annual fee comfort</label>
      <div className="wf-pf-seg wf-pf-seg4">
        {FEE_OPTS.map((o) => (
          <button key={o.key} className={fee === o.key ? 'on' : ''} onClick={() => setFee(o.key)}>{o.label}</button>
        ))}
      </div>

      <label className="wf-pf-l">Do you know your credit score?</label>
      <div className="wf-pf-seg">
        <button className={scoreKnown === true ? 'on' : ''} onClick={() => setScoreKnown(true)}>Yes</button>
        <button className={scoreKnown === false ? 'on' : ''} onClick={() => setScoreKnown(false)}>Not sure</button>
      </div>
      {scoreKnown === true && (
        <div className="wf-pf-score">
          <input type="range" min={550} max={850} value={score}
            onChange={(e) => setScore(parseInt(e.target.value, 10))} />
          <span className="wf-pf-scorev" style={{ color: score < 700 ? '#f59e0b' : '#10b981' }}>{score}</span>
        </div>
      )}
      {scoreKnown === false && (
        <div className="wf-pf-link">
          You can check it free at <a href="https://www.cibil.com/freecibilscore" target="_blank" rel="noreferrer">CIBIL</a> or your bank app. We&rsquo;ll proceed without it.
        </div>
      )}

      <div className="wf-pf-actions">
        {onBack && <button className="wf-pf-back" onClick={onBack}>Back</button>}
        <button className="wf-pf-next" disabled={!valid}
          onClick={() => onContinue({ inHandMonthlyIncome: income, employmentType: emp, feeTolerance: fee, creditScore: scoreKnown ? score : undefined })}>
          Continue →
        </button>
      </div>
    </div>
  );
};

const css = `
.wf-pf{font-family:'DM Sans',system-ui,sans-serif;max-width:560px;margin:0 auto;color:#e4e4e7}
.wf-pf h2{font-size:22px;font-weight:800;color:#fafafa;letter-spacing:-.02em;margin:0 0 6px}
.wf-pf-sub{font-size:13px;color:#a1a1aa;margin:0 0 20px}
.wf-pf-l{display:block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;
  color:#52525b;margin:18px 0 8px}
.wf-pf-l span{text-transform:none;letter-spacing:0;color:#71717a;font-weight:500;margin-left:6px}
.wf-pf-money{display:flex;align-items:center;gap:5px;background:#111113;border:1px solid #27272a;border-radius:10px;padding:0 13px}
.wf-pf-money span{color:#71717a;font-size:14px}
.wf-pf-per{font-size:12px}
.wf-pf-money input{flex:1;background:transparent;border:none;outline:none;color:#fafafa;font-family:inherit;
  font-size:16px;font-weight:600;padding:13px 0}
.wf-pf-money input::-webkit-outer-spin-button,.wf-pf-money input::-webkit-inner-spin-button{-webkit-appearance:none}
.wf-pf-seg{display:flex;gap:7px}
.wf-pf-seg4{flex-wrap:wrap}
.wf-pf-seg button{flex:1;min-width:fit-content;background:#111113;border:1px solid #27272a;color:#a1a1aa;
  font-family:inherit;font-size:13px;font-weight:600;padding:11px;border-radius:9px;cursor:pointer;transition:.15s;white-space:nowrap}
.wf-pf-seg button.on{background:#0a1410;border-color:#10b981;color:#34d399}
.wf-pf-score{display:flex;align-items:center;gap:14px;margin-top:10px}
.wf-pf-score input{flex:1;accent-color:#10b981}
.wf-pf-scorev{font-size:20px;font-weight:800;font-variant-numeric:tabular-nums;min-width:46px;text-align:right}
.wf-pf-link{font-size:12.5px;color:#a1a1aa;margin-top:10px;line-height:1.5}
.wf-pf-link a{color:#10b981;font-weight:600}
.wf-pf-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:26px}
.wf-pf-back{background:#18181b;border:1px solid #27272a;color:#a1a1aa;font-family:inherit;font-size:14px;font-weight:600;padding:11px 18px;border-radius:10px;cursor:pointer}
.wf-pf-next{background:#10b981;border:none;color:#04130c;font-family:inherit;font-size:14px;font-weight:700;padding:11px 22px;border-radius:10px;cursor:pointer;transition:.15s}
.wf-pf-next:disabled{background:#1f2a24;color:#3f5a4e;cursor:not-allowed}
.wf-pf-next:not(:disabled):hover{background:#34d399}
`;

export default ProfileInput;
