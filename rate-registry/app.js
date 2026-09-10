/* WhatIff home-loan registry (v2) — app.js
   Vanilla JS, no build step. Two states on one page (landing+form, result).

   Data model, two tiers:
   - Tier 1 (anonymous, always): submit a rate, see the result. No email.
   - Tier 2 (email, only on intent): captured only when someone opens Door 2 or
     Door 3. The rates table has no email column; contact details live only in
     `outcomes`, linked by id server-side.

   Every write goes through a security-definer RPC that returns only an id; every
   read through one that returns only aggregates. The browser can never read raw
   rows. */

'use strict';

// ===========================================================================
// ASSUMPTIONS — fallback fee estimates. These are used ONLY when a lender has
// no verified fee in the benchmarks table. Once you populate conversion_fee_pct
// / processing_fee_pct per lender (see migration 0002 + the fetch prompt), the
// doors use the lender's real fee and say so. Verify anything here first —
// a wrong net-benefit figure is worse than no figure.
// ===========================================================================
const CONVERSION_FEE_PCT = 0.005;  // fallback: convert/reset rate, % of outstanding (Door 2)
const BT_PROCESSING_PCT  = 0.005;  // fallback: new lender processing fee, % of outstanding (Door 3)
const BT_LEGAL_TECH      = 7500;   // legal + technical valuation, rupees
const BT_MOD_PCT         = 0.0015; // MOD registration, % of loan — varies by state
const MIN_NET_BENEFIT    = 25000;  // below this, recommend doing nothing

// ---------------------------------------------------------------------------
// Config + client
// ---------------------------------------------------------------------------
const CFG = window.WHATIFF_CONFIG || {};
const app = document.getElementById('app');
const tallyEl = document.getElementById('tally');
const footEl = document.getElementById('foot');

let sb = null;
if (CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY &&
    !CFG.SUPABASE_URL.includes('YOUR-PROJECT') &&
    window.supabase && window.supabase.createClient) {
  sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
}

// ---------------------------------------------------------------------------
// Constants (must match the DB check constraints)
// ---------------------------------------------------------------------------
// Grouped for the dropdown; BANKS (flat) is the validation list and must match
// the DB check constraint in migrations 0001 + 0002 exactly.
const BANK_GROUPS = [
  { label: 'Banks', items: [
    'SBI', 'HDFC Bank', 'ICICI Bank', 'Axis Bank', 'Kotak Mahindra', 'Bank of Baroda',
    'IDFC First', 'Canara Bank', 'Union Bank', 'Punjab National Bank', 'Bank of India',
    'IDBI Bank', 'Yes Bank', 'IndusInd Bank', 'Federal Bank', 'Indian Bank',
  ] },
  { label: 'Housing finance / NBFCs', items: [
    'LIC Housing', 'PNB Housing', 'Bajaj Housing', 'Tata Capital', 'Godrej Housing',
    'Aadhar Housing Finance', 'Aavas Financiers', 'Home First Finance', 'Repco Home Finance',
    'Can Fin Homes', 'Sammaan Capital', 'Piramal Finance', 'Sundaram Home Finance',
  ] },
  { label: 'Other', items: ['Other'] },
];
const BANKS = BANK_GROUPS.flatMap(g => g.items);
const AMOUNTS = [
  { v: 20, label: '₹20 lakh' }, { v: 35, label: '₹35 lakh' }, { v: 50, label: '₹50 lakh' },
  { v: 75, label: '₹75 lakh' }, { v: 100, label: '₹1 crore' }, { v: 150, label: '₹1.5 crore' },
];
const RATE_TYPES = ['Floating', 'Fixed'];
const CHANNELS = ['Branch', 'Agent or DSA', 'Online', 'Builder tie-up', "Don't remember"];
const EMPLOYMENT = ['Salaried', 'Self-employed'];
const YEARS = (() => { const a = []; for (let y = 2026; y >= 2015; y--) a.push(y); return a; })();

const REF_PRINCIPAL = 5000000; // ₹50 lakh, for the landing list
const REF_YEARS = 20;

// ---------------------------------------------------------------------------
// Session id
// ---------------------------------------------------------------------------
function getSessionId() {
  let id = null;
  try { id = localStorage.getItem('whatiff_session_id'); } catch (e) {}
  if (!id) {
    id = (crypto && crypto.randomUUID) ? crypto.randomUUID() : fallbackUuid();
    try { localStorage.setItem('whatiff_session_id', id); } catch (e) {}
  }
  return id;
}
function fallbackUuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}
const SESSION_ID = getSessionId();

// ---------------------------------------------------------------------------
// Maths
// ---------------------------------------------------------------------------
function emi(principal, annualRate, years) {
  const r = annualRate / 1200, n = years * 12;
  if (r === 0) return principal / n;
  const p = Math.pow(1 + r, n);
  return principal * r * p / (p - 1);
}
function yearsRemaining(loanYear) { return Math.max(5, 20 - (2026 - loanYear)); }

// Outstanding is estimated by amortising the ORIGINAL amount at the user's
// current rate over a standard 20-year schedule — an approximation, since we
// don't capture the real sanctioned tenure or any prepayments.
function outstandingBalance(principal, annualRate, loanYear) {
  const r = annualRate / 1200, nTotal = 240;
  const elapsed = Math.max(0, Math.min(nTotal, (2026 - loanYear) * 12));
  if (r === 0) return principal * (1 - elapsed / nTotal);
  const powN = Math.pow(1 + r, nTotal), powE = Math.pow(1 + r, elapsed);
  return principal * (powN - powE) / (powN - 1);
}
// Total interest paid on `bal` at `annualRate` over `years`.
function interestOver(bal, annualRate, years) {
  return emi(bal, annualRate, years) * years * 12 - bal;
}
function inr(n) {
  const v = Math.round(n);
  return '₹' + Math.abs(v).toLocaleString('en-IN');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function validEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let submitting = false;
let currentRateId = null;   // returned by submit_rate; held in memory only, never in the URL
let lastPayload = null;     // for client-side duplicate prevention
let lastResult = null;      // { input, cohort, bestBankP25 } to re-render on Back
let outcomeId = null;       // outcomes row id once a door is opened

// ===========================================================================
// LANDING
// ===========================================================================
async function renderLanding() {
  if (!sb) return renderConfigError();
  app.innerHTML = `<div class="thin" style="padding:36px 4px">Loading the registry…</div>`;

  let total = 0, banks = [];
  try {
    const [tc, br] = await Promise.all([sb.rpc('total_count'), sb.rpc('bank_rates', { p_loan_type: 'Home' })]);
    if (tc.error) throw tc.error;
    total = tc.data || 0;
    banks = br.error ? [] : (br.data || []);
  } catch (e) { return renderLoadError(e); }

  tallyEl.innerHTML = total > 0
    ? `<b>${total.toLocaleString('en-IN')}</b> rates shared so far`
    : `Be the first to share a rate`;
  footEl.innerHTML = 'Anonymous. No login. Aggregates only — individual rates and contact details are never shown.';

  app.innerHTML = `
    <section class="hero-card">
      <div class="hero-copy">
        <h1>Are you paying more than you need to on your home loan?</h1>
        <p>Banks advertise a rate almost nobody gets. Borrowers are telling each other what they actually got — so you can see what's achievable at your bank, not just what's advertised.</p>
        <button class="btn hero-cta" id="hero-cta" type="button">See what's achievable <span class="arr">→</span></button>
        <div class="hero-note"><b>Free.</b> No email needed to see your result.</div>
      </div>
      <div class="hero-coins" aria-hidden="true">${coinsCluster()}</div>
    </section>
    <div class="landing-grid">
      ${listSection(total, banks)}
      ${formHtml()}
    </div>
  `;
  const scrollToForm = () => {
    const t = document.getElementById('addrate');
    if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const bank = document.getElementById('f-bank');
    if (bank) setTimeout(() => bank.focus({ preventScroll: true }), 400);
  };
  const cta = document.getElementById('hero-cta');
  if (cta) cta.addEventListener('click', scrollToForm);
  const navCta = document.getElementById('nav-cta');
  if (navCta) navCta.addEventListener('click', scrollToForm);
  wireForm();
}

function listSection(total, banks) {
  if (total < 10 || banks.length === 0) {
    return `
      <div class="card">
        <div class="section-title">What people are actually getting</div>
        <div class="thin" style="margin-top:14px">
          We're just getting started — <b>${total.toLocaleString('en-IN')}</b>
          borrower${total === 1 ? '' : 's'} have shared so far.
          Add yours and check back in a few days.
        </div>
      </div>`;
  }

  const rows = banks.map(b => ({
    bank: b.bank, n: b.n, p25: Number(b.p25_rate),
    emi: emi(REF_PRINCIPAL, Number(b.p25_rate), REF_YEARS),
  }));
  const maxE = Math.max(...rows.map(r => r.emi)), minE = Math.min(...rows.map(r => r.emi));

  const body = rows.map((r, i) => {
    const frac = maxE === minE ? 1 : 0.25 + 0.75 * (r.emi - minE) / (maxE - minE);
    return `
      <div class="bank-row${i === 0 ? ' best' : ''}">
        <div class="rank">${i + 1}</div>
        <div class="bank-main">
          <div class="top">
            <div class="name">${esc(r.bank)}${i === 0 ? '<span class="tagpill">cheapest</span>' : ''}</div>
            <div class="emi">${inr(r.emi)}<span>/mo</span></div>
          </div>
          <div class="bar-track"><div class="bar-fill" style="width:${(frac * 100).toFixed(1)}%"></div></div>
          <div class="meta">around ${r.p25.toFixed(2)}% · from ${r.n} ${r.n === 1 ? 'person' : 'people'}</div>
        </div>
      </div>`;
  }).join('');

  const gap = Math.round(maxE - minE);
  const takeaway = gap >= 200
    ? `<div class="list-takeaway">On the very same loan, that's about <b>${inr(gap)}/mo</b> between the cheapest and the priciest bank here.</div>`
    : '';

  return `
    <div class="card">
      <div class="section-title">What people are actually getting</div>
      <div class="section-sub">Real rates people told us they got, bank by bank — shown as the monthly payment (EMI) on the same ₹50 lakh, 20-year loan, so you can compare fairly. Cheapest first.</div>
      ${body}
      ${takeaway}
    </div>`;
}

// A single 3D-ish lavender ₹ coin (inline SVG, on-brand, no external asset).
function coinSvg() {
  return `<svg viewBox="0 0 100 108" xmlns="http://www.w3.org/2000/svg">
    <defs><radialGradient id="cf" cx="38%" cy="30%" r="82%">
      <stop offset="0" stop-color="#F5F0FC"/><stop offset="42%" stop-color="#C9C2DD"/><stop offset="100%" stop-color="#7C749C"/>
    </radialGradient></defs>
    <ellipse cx="50" cy="57" rx="45" ry="45" fill="#453f63"/>
    <ellipse cx="50" cy="54" rx="45" ry="45" fill="#6b6490"/>
    <circle cx="50" cy="50" r="45" fill="url(#cf)" stroke="#F1ECF9" stroke-width="2.5"/>
    <circle cx="50" cy="50" r="37" fill="none" stroke="#8b83a8" stroke-width="1" stroke-dasharray="1 3.4" opacity=".7"/>
    <g fill="none" stroke="#8b83a8" stroke-width="2" opacity=".5">
      <ellipse cx="50" cy="50" rx="22" ry="9" transform="rotate(32 50 50)"/>
      <ellipse cx="50" cy="50" rx="22" ry="9" transform="rotate(-32 50 50)"/>
    </g>
    <text x="50" y="51" text-anchor="middle" dominant-baseline="central"
          font-family="DM Sans, sans-serif" font-weight="800" font-size="42" fill="#2B2644">₹</text>
  </svg>`;
}

// A cluster of floating coins for the hero card's right side.
function coinsCluster() {
  const coins = [
    { l: '50%', t: '4%',  s: 62, d: '0s',   dur: '6.6s' },
    { l: '14%', t: '26%', s: 54, d: '.7s',  dur: '7.5s' },
    { l: '56%', t: '44%', s: 92, d: '.3s',  dur: '8.1s' },
    { l: '82%', t: '26%', s: 42, d: '1.1s', dur: '6.9s' },
    { l: '84%', t: '60%', s: 50, d: '.9s',  dur: '7.2s' },
    { l: '26%', t: '66%', s: 70, d: '1.5s', dur: '7.9s' },
  ].map(c =>
    `<span class="coin" style="left:${c.l};top:${c.t};width:${c.s}px;height:${c.s}px;
       animation-delay:${c.d};animation-duration:${c.dur}">${coinSvg()}</span>`
  ).join('');
  return `<span class="glow"></span>${coins}`;
}

function formHtml() {
  const bankOpts = BANK_GROUPS.map(g =>
    `<optgroup label="${esc(g.label)}">${g.items.map(b => `<option value="${esc(b)}">${esc(b)}</option>`).join('')}</optgroup>`
  ).join('');
  const yearOpts = YEARS.map(y => `<option value="${y}">${y}</option>`).join('');
  const amtOpts = AMOUNTS.map(a => `<option value="${a.v}">${esc(a.label)}</option>`).join('');
  const chanOpts = CHANNELS.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  const typeOpts = RATE_TYPES.map(t => `<div class="opt" data-type="${t}">${t}</div>`).join('');
  const empOpts = EMPLOYMENT.map(e => `<div class="opt" data-emp="${e}">${e}</div>`).join('');

  return `
    <div class="card" id="addrate">
      <div class="form-title">Add your rate</div>
      <div class="form-sub">Seven questions, under a minute. Anonymous — no phone, no email.</div>

      <div class="field">
        <label for="f-bank">Your bank</label>
        <select id="f-bank"><option value="" disabled selected>Choose a bank</option>${bankOpts}</select>
      </div>
      <div class="field">
        <label for="f-rate">Your interest rate (%)</label>
        <input id="f-rate" type="number" inputmode="decimal" step="0.01" min="6" max="15" placeholder="e.g. 8.75" />
      </div>
      <div class="field">
        <label for="f-year">Year you took it</label>
        <select id="f-year"><option value="" disabled selected>Choose a year</option>${yearOpts}</select>
      </div>
      <div class="field">
        <label for="f-amt">Loan amount</label>
        <select id="f-amt"><option value="" disabled selected>Choose an amount</option>${amtOpts}</select>
      </div>
      <div class="field">
        <label>Rate type</label>
        <div class="seg" id="f-type">${typeOpts}</div>
      </div>
      <div class="field">
        <label for="f-chan">How did you get the loan?</label>
        <select id="f-chan"><option value="" disabled selected>Choose one</option>${chanOpts}</select>
      </div>
      <div class="field">
        <label>Employment</label>
        <div class="seg" id="f-emp">${empOpts}</div>
      </div>

      <button class="btn" id="f-submit">See what's achievable at your bank</button>
      <div class="form-error" id="f-error"></div>
    </div>`;
}

function wireForm() {
  const state = { rate_type: null, employment: null };
  document.querySelectorAll('#f-type .opt').forEach(el => el.addEventListener('click', () => {
    document.querySelectorAll('#f-type .opt').forEach(o => o.classList.remove('on'));
    el.classList.add('on'); state.rate_type = el.dataset.type;
  }));
  document.querySelectorAll('#f-emp .opt').forEach(el => el.addEventListener('click', () => {
    document.querySelectorAll('#f-emp .opt').forEach(o => o.classList.remove('on'));
    el.classList.add('on'); state.employment = el.dataset.emp;
  }));
  document.getElementById('f-submit').addEventListener('click', () => submit(state));
}

function showError(msg) { const el = document.getElementById('f-error'); if (el) el.textContent = msg; }

// ===========================================================================
// SUBMIT
// ===========================================================================
async function submit(state) {
  if (submitting) return;
  showError('');

  const bank = document.getElementById('f-bank').value;
  const rate = parseFloat(document.getElementById('f-rate').value);
  const loan_year = parseInt(document.getElementById('f-year').value, 10);
  const amount_lakh = parseInt(document.getElementById('f-amt').value, 10);
  const rate_type = state.rate_type;
  const channel = document.getElementById('f-chan').value;
  const employment = state.employment;

  if (!bank) return showError('Pick your bank.');
  if (!(rate >= 6 && rate <= 15)) return showError('Enter a rate between 6% and 15%.');
  if (!loan_year) return showError('Pick the year you took the loan.');
  if (!amount_lakh) return showError('Pick a loan amount.');
  if (!rate_type) return showError('Pick floating or fixed.');
  if (!channel) return showError('Pick how you got the loan.');
  if (!employment) return showError('Pick salaried or self-employed.');

  const input = { loan_type: 'Home', bank, rate: Math.round(rate * 100) / 100,
                  loan_year, amount_lakh, rate_type, channel, employment };

  // Client-side duplicate prevention: identical payload → skip the insert and
  // re-show the existing result (Back never creates a second row).
  const payloadKey = JSON.stringify(input);
  if (payloadKey === lastPayload && currentRateId && lastResult) {
    return renderResult(lastResult);
  }

  const btn = document.getElementById('f-submit');
  submitting = true; btn.disabled = true; btn.textContent = 'Saving…';

  try {
    const ins = await sb.rpc('submit_rate', {
      p_session_id: SESSION_ID, p_loan_type: 'Home', p_bank: bank, p_rate: input.rate,
      p_loan_year: loan_year, p_amount_lakh: amount_lakh, p_rate_type: rate_type,
      p_channel: channel, p_employment: employment,
    });
    if (ins.error) throw ins.error;
    currentRateId = ins.data;
    lastPayload = payloadKey;
    outcomeId = null;
    if (window.umami) window.umami.track('Submission');

    const [cs, br, bm] = await Promise.all([
      sb.rpc('cohort_stats', {
        p_loan_type: 'Home', p_bank: bank, p_year: loan_year,
        p_channel: channel, p_employment: employment,
      }),
      sb.rpc('bank_rates', { p_loan_type: 'Home' }),
      sb.rpc('bank_benchmark', { p_bank: bank }),
    ]);
    if (cs.error) throw cs.error;

    const cohort = (cs.data && cs.data[0]) || { rates: [], median_rate: null, p25_rate: null, n: 0, tier: 4, tier_label: '' };
    const banks = br.error ? [] : (br.data || []);
    // Best (cheapest) bank = the Door 3 transfer target; carry its processing fee.
    let bestBankP25 = null, targetProcessingPct = null, targetProcessingFlat = null;
    if (banks.length) {
      const best = banks.reduce((a, b) => Number(b.p25_rate) < Number(a.p25_rate) ? b : a);
      bestBankP25 = Number(best.p25_rate);
      targetProcessingPct = best.processing_fee_pct != null ? Number(best.processing_fee_pct) : null;
      targetProcessingFlat = best.processing_fee_flat != null ? Number(best.processing_fee_flat) : null;
    }
    // Verified benchmark for this bank, or null when none is on file (then the
    // advertised line is simply omitted — no unsourced number is ever shown).
    const benchmark = (bm && !bm.error && bm.data && bm.data[0]) ? bm.data[0] : null;
    // Per-lender fees, verified where available; null falls back to the labelled
    // ASSUMPTION constants inside computeDoors. A conversion fee may be a flat
    // rupee amount (common) or a % of the loan.
    const fees = {
      conversionFlat: benchmark && benchmark.conversion_fee_flat != null ? Number(benchmark.conversion_fee_flat) : null,
      conversionPct: benchmark && benchmark.conversion_fee_pct != null ? Number(benchmark.conversion_fee_pct) : null,
      processingPct: targetProcessingPct,
      processingFlat: targetProcessingFlat,
    };

    lastResult = { input, cohort, bestBankP25, benchmark, fees };
    renderResult(lastResult);
  } catch (e) {
    submitting = false; btn.disabled = false; btn.textContent = 'See what\'s achievable at your bank';
    const msg = String(e && e.message || e);
    if (msg.includes('rate_limit_exceeded')) showError("You've shared a lot in the last hour — take a break and come back later.");
    else showError('Something went wrong saving that. Please try again.');
    return;
  }
  submitting = false;
}

// ===========================================================================
// RESULT
// ===========================================================================
function computeDoors(input, cohort, bestBankP25, fees) {
  const principal = input.amount_lakh * 100000;
  const outstanding = outstandingBalance(principal, input.rate, input.loan_year);
  const yrs = yearsRemaining(input.loan_year);
  const iUser = interestOver(outstanding, input.rate, yrs);

  const cohortP25 = cohort.p25_rate == null ? null : Number(cohort.p25_rate);

  // Fee rates: the lender's verified figure when we have it, else the labelled
  // ASSUMPTION default. `feeVerified` lets the UI say whether it's the real fee.
  // The conversion (Door 2) fee is a flat rupee amount for many lenders.
  const convFlat = (fees && fees.conversionFlat != null) ? fees.conversionFlat : null;
  const convPct  = (fees && fees.conversionPct != null) ? fees.conversionPct : null;
  const procFlat = (fees && fees.processingFlat != null) ? fees.processingFlat : null;
  const procPct  = (fees && fees.processingPct != null) ? fees.processingPct : BT_PROCESSING_PCT;
  const convVerified = convFlat != null || convPct != null;
  const procVerified = !!(fees && (fees.processingPct != null || fees.processingFlat != null));
  const convCost = (bal) => convFlat != null ? convFlat
                          : convPct != null ? bal * convPct
                          : bal * CONVERSION_FEE_PCT;
  // Door-3 processing is the target lender's flat takeover fee when it charges
  // one (e.g. Bank of Baroda Rs 8,500), else a % of the balance. MOD and
  // legal/valuation are added separately in the door.
  const procCost = (bal) => procFlat != null ? procFlat : bal * procPct;

  // Door 2 — convert spread with the same lender, target = cohort p25.
  let door2 = null;
  if (cohortP25 != null) {
    const cost = convCost(outstanding);
    const gross = cohortP25 < input.rate ? iUser - interestOver(outstanding, cohortP25, yrs) : 0;
    door2 = { target: cohortP25, cost, gross, net: gross - cost, feeVerified: convVerified, noGap: !(cohortP25 < input.rate) };
  }

  // Door 3 — balance transfer, target = best bank p25 across the registry.
  let door3 = null;
  if (bestBankP25 != null) {
    const cost = procCost(outstanding) + outstanding * BT_MOD_PCT + BT_LEGAL_TECH;
    const gross = bestBankP25 < input.rate ? iUser - interestOver(outstanding, bestBankP25, yrs) : 0;
    door3 = { target: bestBankP25, cost, gross, net: gross - cost, feeVerified: procVerified, noGap: !(bestBankP25 < input.rate) };
  }

  return { outstanding, yrs, iUser, cohortP25, door2, door3 };
}

function renderResult(res) {
  window.scrollTo(0, 0);
  const { input, cohort, bestBankP25, benchmark, fees } = res;
  const rates = (cohort.rates || []).map(Number);
  const calc = computeDoors(input, cohort, bestBankP25, fees);

  // Truly thin: even the widest tier has < 4 reports.
  if (calc.cohortP25 == null) {
    app.innerHTML = `
      <div class="card">
        <div class="result-lead">
          <div class="frame">Your rate is saved. We just don't have enough reports for
            <b>${esc(input.bank)}</b> yet to show a fair comparison.</div>
          <div class="caveat">We won't show a number until at least four people have shared — so it actually means something. Check back in a few days.</div>
        </div>
      </div>
      ${backButtonHtml()}`;
    wireBack();
    return;
  }

  const principal = input.amount_lakh * 100000;
  const userEmi = emi(calc.outstanding, input.rate, calc.yrs);
  const achEmi = emi(calc.outstanding, calc.cohortP25, calc.yrs);
  const monthlyDiff = userEmi - achEmi;

  const lessCount = rates.filter(r => r < input.rate).length;
  const nLess = rates.length ? Math.round((lessCount / rates.length) * 10) : 0;

  // Which door to recommend: highest net that clears the floor, else Door 1.
  const nets = [];
  if (calc.door2 && !calc.door2.noGap) nets.push(['door2', calc.door2.net]);
  if (calc.door3 && !calc.door3.noGap) nets.push(['door3', calc.door3.net]);
  let rec = 'door1';
  if (nets.length) {
    nets.sort((a, b) => b[1] - a[1]);
    if (nets[0][1] > MIN_NET_BENEFIT) rec = nets[0][0];
  }

  const cohortLine = `Based on ${cohort.n} ${esc(input.employment.toLowerCase())} borrower${cohort.n === 1 ? '' : 's'} who took a ${esc(input.bank)} loan in ${input.loan_year} through ${esc(input.channel.toLowerCase())}.`;
  const widenLine = cohort.tier > 1
    ? `<div class="cohort-note widen">Not enough reports for your exact situation yet, so this compares you with ${esc(cohort.tier_label)}.</div>`
    : `<div class="cohort-note">${cohortLine}</div>`;

  app.innerHTML = `
    <div class="result-grid">
    <div class="result-col">
    <div class="card">
      <div class="result-lead">
        <div class="frame"><b>${nLess}</b> out of 10 people who borrowed from ${esc(input.bank)} report a lower rate than yours.</div>
        ${pictographHtml(nLess)}
        <div class="caveat">Rates depend on your credit score, employer, salary and how you applied — so yours may be different for good reasons. This shows what's possible at your bank, not that you were charged unfairly.</div>
      </div>
      ${widenLine}
      ${cohort.tier > 1 ? `<div class="cohort-note">${cohortLine}</div>` : ''}
    </div>

    <div class="card">
      <div class="emi-pair">
        <div class="emi-box">
          <div class="lbl">You pay</div>
          <div class="val">${input.rate.toFixed(2)}%</div>
          <div class="sub">${inr(userEmi)} a month</div>
        </div>
        <div class="emi-box ach">
          <div class="lbl">Others get at ${esc(input.bank)}</div>
          <div class="val">${calc.cohortP25.toFixed(2)}%</div>
          <div class="sub">${inr(achEmi)} a month</div>
        </div>
      </div>
      <div class="emi-diff">
        ${monthlyDiff > 0
          ? `That's about <b>${inr(monthlyDiff)} a month</b> more than others at your bank — on what you still owe.`
          : `You're already getting a rate as good as others at your bank — <b>nothing to chase here.</b>`}
      </div>
      ${benchmarkLine(input, benchmark)}
    </div>

    <div class="card" style="padding:0;overflow:hidden">
      <details class="dotwrap">
        <summary>See everyone's rates</summary>
        <div class="dotplot">
          <div class="cap">Every rate people shared in this group. Yours is marked.</div>
          ${dotPlotSvg(rates, input.rate, Number(cohort.median_rate == null ? calc.cohortP25 : cohort.median_rate))}
        </div>
      </details>
    </div>
    </div>

    <div class="result-col rc-doors">
    <div class="card">
      <div class="doors-title">What you can actually do about it</div>
      ${doorHtml(1, rec, calc)}
      ${doorHtml(2, rec, calc)}
      ${doorHtml(3, rec, calc)}
    </div>
    </div>
    </div>

    ${backButtonHtml()}`;

  wireDoors();
  wireBack();
}

function doorHtml(n, rec, calc) {
  const isRec = rec === `door${n}`;
  const tag = isRec ? `<div class="dtag">Recommended</div>` : '';

  if (n === 1) {
    return `
      <div class="door ${isRec ? 'rec' : ''}">
        ${tag}<div class="dnum">Door 1</div>
        <h3>Nothing to do right now</h3>
        <div class="net none">The savings wouldn't cover the cost of switching right now. We'll tell you if that changes.</div>
      </div>`;
  }

  if (n === 2) {
    const d = calc.door2;
    if (!d) return '';
    if (d.noGap) {
      return `
        <div class="door ${isRec ? 'rec' : ''}">
          ${tag}<div class="dnum">Door 2</div>
          <h3>Ask your bank to convert your spread</h3>
          <div class="net none">Your rate already matches what others get at your bank.</div>
        </div>`;
    }
    const template =
`Subject: Request to convert my home loan to the current spread

Hello,

I'd like to convert my existing home loan (account no. __________) to your
current spread for my profile. Please keep the same tenure — no top-up, and no
change to the outstanding schedule. Kindly confirm the revised rate and the
one-time conversion fee before processing.

Thank you.`;
    return `
      <div class="door ${isRec ? 'rec' : ''}" data-door="Conversion">
        ${tag}<div class="dnum">Door 2</div>
        <h3>Ask your bank to convert your spread</h3>
        <div class="dsub">In plain words: get your bank to put today's lower rate on your existing loan — no new loan, no longer tenure.</div>
        <div class="net">You'd save about <b>${inr(d.net)}</b> — after a one-time fee of roughly ${inr(d.cost)}.</div>
        <div class="cost">That's ${inr(d.gross)} saved over the years left on your loan, minus the fee. ${d.feeVerified ? "Fee is your bank's published figure — still confirm before you commit." : "Fee is an estimate — check with your bank."}</div>
        <div class="dbody">
          <div class="template">${esc(template)}</div>
          <div class="warning">If you simply ask for <b>"a lower rate,"</b> many lenders respond with a top-up — your existing loan is closed and reopened with a fresh tenure, a processing fee, and sometimes insurance you were never shown. You end up paying more over the life of the loan. Ask specifically for a <b>conversion to the current spread on your existing loan, with no change to tenure and no top-up.</b></div>
          <div class="door-cta" data-door-cta="Conversion"></div>
        </div>
      </div>`;
  }

  // n === 3
  const d = calc.door3;
  if (!d) return '';
  if (d.noGap) {
    return `
      <div class="door ${isRec ? 'rec' : ''}">
        ${tag}<div class="dnum">Door 3</div>
        <h3>Move to another lender</h3>
        <div class="net none">No other bank here is currently cheaper than your rate.</div>
      </div>`;
  }
  return `
    <div class="door ${isRec ? 'rec' : ''}" data-door="Transfer">
      ${tag}<div class="dnum">Door 3</div>
      <h3>Move to another lender</h3>
      <div class="dsub">Switch your loan to a cheaper bank. There's paperwork and some upfront cost, but the savings can be big.</div>
      <div class="net">You'd save about <b>${inr(d.net)}</b> — after roughly ${inr(d.cost)} in switching costs (processing, legal, valuation, registration).</div>
      <div class="cost">That's ${inr(d.gross)} saved over the years left on your loan, minus those costs. ${d.feeVerified ? "Processing fee is the new lender's published figure; legal, valuation and stamp costs are estimates — confirm before you move." : "Fees are estimates — check before you move."}</div>
      <div class="dbody">
        <p style="font-size:13.5px;color:var(--muted);margin-bottom:4px">We can handle the paperwork. Leave your email and we'll come back.</p>
        <div class="door-cta" data-door-cta="Transfer"></div>
      </div>
    </div>`;
}

function wireDoors() {
  document.querySelectorAll('[data-door-cta]').forEach(slot => {
    const door = slot.getAttribute('data-door-cta');
    renderDoorCta(slot, door, false);
  });
}

function renderDoorCta(slot, door, done) {
  if (done) {
    slot.innerHTML = `<div class="email-ok">✓ Got it. We'll be in touch.</div>`;
    return;
  }
  const label = door === 'Conversion' ? 'Email me this template' : 'Email me — help me move';
  slot.innerHTML = `
    <div class="email-row">
      <input type="email" inputmode="email" placeholder="you@email.com" aria-label="Your email" />
      <button class="btn btn-sm" type="button">${label}</button>
    </div>
    <div class="form-error" style="text-align:left"></div>`;
  const input = slot.querySelector('input');
  const btn = slot.querySelector('button');
  const err = slot.querySelector('.form-error');
  btn.addEventListener('click', async () => {
    const email = input.value.trim();
    if (!validEmail(email)) { err.textContent = 'Enter a valid email.'; return; }
    err.textContent = '';
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const r = await sb.rpc('record_outcome', { p_rate_id: currentRateId, p_door: door, p_email: email });
      if (r.error) throw r.error;
      outcomeId = r.data;
      if (window.umami) window.umami.track('DoorOpen', { door });
      renderDoorCta(slot, door, true);
    } catch (e) {
      btn.disabled = false; btn.textContent = label;
      err.textContent = 'Could not save that. Please try again.';
    }
  });
}

function dotPlotSvg(rates, userRate, median) {
  const W = 100, H = 46, lo = 6, hi = 15, baseY = 30;
  const x = v => ((v - lo) / (hi - lo)) * W;
  const seen = {};
  const dots = rates.map(r => {
    const key = r.toFixed(2);
    const k = (seen[key] = (seen[key] || 0) + 1);
    const dy = ((k - 1) % 5) * 3.2;
    return { cx: x(r), cy: baseY - dy, isUser: Math.abs(r - userRate) < 0.005 && k === 1 };
  });
  if (!dots.some(d => d.isUser)) {
    let best = null, bd = Infinity;
    dots.forEach(d => { const dd = Math.abs(d.cx - x(userRate)); if (dd < bd) { bd = dd; best = d; } });
    if (best) best.isUser = true;
  }
  const circles = dots.map(d =>
    `<circle cx="${d.cx.toFixed(2)}" cy="${d.cy.toFixed(2)}" r="${d.isUser ? 2.6 : 1.7}"
       fill="${d.isUser ? 'var(--ink)' : 'var(--lav2)'}"
       ${d.isUser ? 'stroke="#fff" stroke-width="0.8"' : 'opacity="0.75"'} />`).join('');
  const medX = x(median);
  const clampLbl = v => Math.max(4, Math.min(96, v));
  const ticks = [6, 9, 12, 15].map(t =>
    `<text x="${clampLbl(x(t)).toFixed(1)}" y="44" font-size="3.2" fill="var(--muted)" text-anchor="middle">${t}%</text>`).join('');
  return `
    <svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Distribution of rates in this cohort">
      <line x1="0" y1="33" x2="${W}" y2="33" stroke="var(--line)" stroke-width="0.5"/>
      <line x1="${medX.toFixed(2)}" y1="6" x2="${medX.toFixed(2)}" y2="33" stroke="var(--muted)" stroke-width="0.5" stroke-dasharray="1.5 1.5"/>
      <text x="${medX.toFixed(2)}" y="5" font-size="3.2" fill="var(--muted)" text-anchor="middle">median</text>
      ${circles}${ticks}
    </svg>`;
}

// The advertised line, shown ONLY when a verified benchmark row exists for this
// bank. Every figure carries its source and as-of date, so the "advertised floor
// almost nobody gets" claim is attributable, never asserted by us.
function benchmarkLine(input, b) {
  if (!b) return '';
  const adv = b.advertised_floor != null ? Number(b.advertised_floor) : null;
  const rllr = b.rllr != null ? Number(b.rllr) : null;
  const shown = adv != null ? adv : rllr;
  if (shown == null) return '';
  const kind = adv != null ? 'advertises this loan from' : 'floating floor (RLLR) is';
  let host = '';
  try { host = b.source_url ? new URL(b.source_url).hostname.replace(/^www\./, '') : ''; } catch (e) {}
  const src = b.source_url
    ? `<a href="${esc(b.source_url)}" target="_blank" rel="noopener nofollow">${esc(host || 'source')}</a>`
    : 'source on file';
  return `
    <div class="benchmark">
      ${esc(input.bank)} ${kind} <b>${shown.toFixed(2)}%</b> — you're paying ${input.rate.toFixed(2)}%.
      <span class="src">Published rate, ${src}${b.as_of ? ' · as of ' + esc(String(b.as_of)) : ''}.</span>
    </div>`;
}

// 10-person pictograph for the "{n} out of 10" stat. The first n are "pay less".
function pictographHtml(nLess) {
  const person = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 12a5 5 0 100-10 5 5 0 000 10zm0 2c-5 0-9 2.5-9 6v2h18v-2c0-3.5-4-6-9-6z"/></svg>`;
  let cells = '';
  for (let i = 0; i < 10; i++) cells += `<span class="pc ${i < nLess ? 'less' : 'you'}">${person}</span>`;
  return `<div class="picto" role="img" aria-label="${nLess} out of 10 pay less than you">${cells}</div>`;
}

function backButtonHtml() { return `<button class="btn btn-ghost" id="f-back">← Back to the registry</button>`; }
function wireBack() { const b = document.getElementById('f-back'); if (b) b.addEventListener('click', renderLanding); }

// ===========================================================================
// Error / config states
// ===========================================================================
function renderConfigError() {
  tallyEl.textContent = '';
  app.innerHTML = `
    <div class="card"><div class="thin" style="padding:24px 4px">
      <b>Not configured yet.</b><br/>Copy <code>config.example.js</code> to
      <code>config.js</code> and add your Supabase URL and anon key. See the README.
    </div></div>`;
}
function renderLoadError(e) {
  console.error('[whatiff] load failed:', e);
  app.innerHTML = `
    <div class="card"><div class="thin" style="padding:24px 4px">
      Couldn't reach the registry just now. Please refresh in a moment.
    </div></div>${formHtml()}`;
  wireForm();
}

// ---------------------------------------------------------------------------
renderLanding();
