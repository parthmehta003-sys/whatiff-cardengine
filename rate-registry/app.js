/* WhatIff rate registry — app.js
   Vanilla JS, no build step. Two states on one page (landing+form, result),
   swapped in place. Insert and read are two separate calls: we INSERT the row,
   then fetch cohort aggregates that include the row just added. The browser can
   never read raw rows — all reads go through security-definer RPCs. */

'use strict';

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
const BANKS = [
  'SBI', 'HDFC Bank', 'ICICI Bank', 'Axis Bank', 'Kotak Mahindra', 'LIC Housing',
  'Bank of Baroda', 'PNB Housing', 'Bajaj Housing', 'IDFC First', 'Canara Bank', 'Union Bank'
];
const AMOUNTS = [20, 35, 50, 75, 100];
const RATE_TYPES = ['Floating', 'Fixed'];
const YEARS = (() => { const a = []; for (let y = 2026; y >= 2015; y--) a.push(y); return a; })();

const REF_PRINCIPAL = 5000000; // ₹50 lakh, for the landing list + headline
const REF_YEARS = 20;

// ---------------------------------------------------------------------------
// Session id (anonymous, persisted in localStorage, sent with every insert)
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
  const r = annualRate / 1200;
  const n = years * 12;
  if (r === 0) return principal / n;
  const p = Math.pow(1 + r, n);
  return principal * r * p / (p - 1);
}
function yearsRemaining(loanYear) {
  return Math.max(5, 20 - (2026 - loanYear));
}
function inr(n) { return '₹' + Math.round(n).toLocaleString('en-IN'); }

// ---------------------------------------------------------------------------
// Tiny DOM helpers
// ---------------------------------------------------------------------------
function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let submitting = false;

// ===========================================================================
// LANDING
// ===========================================================================
async function renderLanding() {
  if (!sb) return renderConfigError();

  app.innerHTML = `<div class="thin" style="padding:36px 4px">Loading the registry…</div>`;

  let total = 0, medians = [], headline = null;
  try {
    const [tc, bm, hg] = await Promise.all([
      sb.rpc('total_count'),
      sb.rpc('bank_medians'),
      sb.rpc('headline_gap'),
    ]);
    if (tc.error) throw tc.error;
    total = tc.data || 0;
    medians = (bm.error ? [] : (bm.data || []));
    headline = hg.error ? null : (hg.data && hg.data[0]) || null;
  } catch (e) {
    return renderLoadError(e);
  }

  tallyEl.innerHTML = total > 0
    ? `<b>${total.toLocaleString('en-IN')}</b> rates shared so far`
    : `Be the first to share a rate`;
  footEl.textContent = 'Anonymous. No login. Aggregates only — individual rates are never shown.';

  app.innerHTML = `
    ${headlineHtml(headline)}
    ${listSection(total, medians)}
    ${formHtml()}
  `;
  wireForm();
}

function headlineHtml(h) {
  let title = 'Same bank. Same year. Same loan. Different EMI.';
  if (h && h.n >= 40 && h.gap != null && h.base_rate != null) {
    const gapRupees = emi(REF_PRINCIPAL, Number(h.base_rate) + Number(h.gap), REF_YEARS)
                    - emi(REF_PRINCIPAL, Number(h.base_rate), REF_YEARS);
    if (gapRupees >= 1) {
      title = `Same bank. Same year. Same loan. <span class="amt">${inr(gapRupees)}</span> a month apart.`;
    }
  }
  return `
    <div class="headline">
      <h1>${title}</h1>
      <p>Plenty of people who check are already paying a fair rate. If that's you, we'll say so.</p>
    </div>`;
}

function listSection(total, medians) {
  // Under 10 total rows: hide the bank list, show the getting-started note.
  if (total < 10 || medians.length === 0) {
    return `
      <div class="card">
        <div class="section-title">What other borrowers are actually paying</div>
        <div class="thin" style="margin-top:14px">
          We're just getting started — <b>${total.toLocaleString('en-IN')}</b>
          borrower${total === 1 ? '' : 's'} have shared so far.
          Add yours and check back in a few days.
        </div>
      </div>`;
  }

  // EMI on a ₹50 lakh 20-year loan, cheapest first (already sorted by median asc).
  const rows = medians.map(m => ({
    bank: m.bank,
    n: m.n,
    rate: Number(m.median_rate),
    emi: emi(REF_PRINCIPAL, Number(m.median_rate), REF_YEARS),
  }));
  const maxEmi = Math.max(...rows.map(r => r.emi));
  const minEmi = Math.min(...rows.map(r => r.emi));

  const body = rows.map(r => {
    // Scale the bar so the cheapest still reads as a bar, not an empty track.
    const frac = maxEmi === minEmi ? 1 : 0.25 + 0.75 * (r.emi - minEmi) / (maxEmi - minEmi);
    return `
      <div class="bank-row">
        <div class="top">
          <div class="name">${esc(r.bank)}</div>
          <div class="emi">${inr(r.emi)}<span>/mo</span></div>
        </div>
        <div class="bar-track"><div class="bar-fill" style="width:${(frac * 100).toFixed(1)}%"></div></div>
        <div class="meta">median ${r.rate.toFixed(2)}% · ${r.n} report${r.n === 1 ? '' : 's'}</div>
      </div>`;
  }).join('');

  return `
    <div class="card">
      <div class="section-title">What other borrowers are actually paying</div>
      <div class="section-sub">Median EMI on a ₹50 lakh, 20-year loan. Cheapest first.</div>
      ${body}
    </div>`;
}

function formHtml() {
  const bankOpts = BANKS.map(b => `<option value="${esc(b)}">${esc(b)}</option>`).join('');
  const yearOpts = YEARS.map(y => `<option value="${y}">${y}</option>`).join('');
  const amtOpts = AMOUNTS.map(a => `<div class="opt" data-amt="${a}">₹${a}L</div>`).join('');
  const typeOpts = RATE_TYPES.map(t => `<div class="opt" data-type="${t}">${t}</div>`).join('');

  return `
    <div class="card">
      <div class="form-title">Add your rate</div>
      <div class="form-sub">Takes ten seconds. Anonymous. See how yours compares.</div>

      <div class="field">
        <label for="f-bank">Your lender</label>
        <select id="f-bank"><option value="" disabled selected>Choose a bank</option>${bankOpts}</select>
      </div>

      <div class="field">
        <label for="f-rate">Your interest rate (%)</label>
        <input id="f-rate" type="number" inputmode="decimal" step="0.01" min="6" max="15"
               placeholder="e.g. 8.75" />
      </div>

      <div class="field">
        <label for="f-year">Year the loan started</label>
        <select id="f-year"><option value="" disabled selected>Choose a year</option>${yearOpts}</select>
      </div>

      <div class="field">
        <label>Loan amount</label>
        <div class="seg" id="f-amt">${amtOpts}</div>
      </div>

      <div class="field">
        <label>Rate type</label>
        <div class="seg" id="f-type">${typeOpts}</div>
      </div>

      <button class="btn" id="f-submit">See how yours compares</button>
      <div class="form-error" id="f-error"></div>
    </div>`;
}

function wireForm() {
  const state = { amount_lakh: null, rate_type: null };

  document.querySelectorAll('#f-amt .opt').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('#f-amt .opt').forEach(o => o.classList.remove('on'));
      el.classList.add('on');
      state.amount_lakh = Number(el.dataset.amt);
    });
  });
  document.querySelectorAll('#f-type .opt').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('#f-type .opt').forEach(o => o.classList.remove('on'));
      el.classList.add('on');
      state.rate_type = el.dataset.type;
    });
  });

  document.getElementById('f-submit').addEventListener('click', () => submit(state));
}

function showError(msg) {
  const el = document.getElementById('f-error');
  if (el) el.textContent = msg;
}

// ===========================================================================
// SUBMIT  (insert first, then fetch cohort stats)
// ===========================================================================
async function submit(state) {
  if (submitting) return;
  showError('');

  const bank = document.getElementById('f-bank').value;
  const rate = parseFloat(document.getElementById('f-rate').value);
  const loan_year = parseInt(document.getElementById('f-year').value, 10);
  const amount_lakh = state.amount_lakh;
  const rate_type = state.rate_type;

  if (!bank) return showError('Pick your lender.');
  if (!(rate >= 6 && rate <= 15)) return showError('Enter a rate between 6% and 15%.');
  if (!loan_year) return showError('Pick the year the loan started.');
  if (!amount_lakh) return showError('Pick a loan amount.');
  if (!rate_type) return showError('Pick floating or fixed.');

  const btn = document.getElementById('f-submit');
  submitting = true;
  btn.disabled = true;
  btn.textContent = 'Saving…';

  const record = {
    bank,
    rate: Math.round(rate * 100) / 100,
    loan_year,
    amount_lakh,
    rate_type,
    session_id: SESSION_ID,
  };

  try {
    const ins = await sb.from('rates').insert(record);
    if (ins.error) throw ins.error;

    // Analytics goal: this is the number that matters (visitors -> submissions).
    if (window.plausible) window.plausible('Submission');

    const { data, error } = await sb.rpc('cohort_stats', { p_bank: bank, p_year: loan_year });
    if (error) throw error;

    const cohort = (data && data[0]) || { rates: [], median_rate: null, n: 0, fell_back: false };
    renderResult({ input: record, cohort });
  } catch (e) {
    submitting = false;
    btn.disabled = false;
    btn.textContent = 'See how yours compares';
    const msg = String(e && e.message || e);
    if (msg.includes('rate_limit_exceeded')) {
      showError("You've shared a lot in the last hour — take a break and come back later.");
    } else {
      showError('Something went wrong saving that. Please try again.');
    }
    return;
  }
  submitting = false;
}

// ===========================================================================
// RESULT
// ===========================================================================
function renderResult({ input, cohort }) {
  window.scrollTo(0, 0);
  const rates = (cohort.rates || []).map(Number);
  const median = cohort.median_rate == null ? null : Number(cohort.median_rate);

  // Never show a median from fewer than 4 reports (the RPC already nulls it).
  if (median == null) {
    app.innerHTML = `
      <div class="card">
        <div class="result-lead">
          <div class="kicker">Your rate is in. There just aren't enough reports for
            ${esc(input.bank)} yet to compare fairly.</div>
          <div class="big fair">You're one of the first.</div>
          <div class="big-sub">We never show a median built from fewer than four reports.
            Check back in a few days as more rates come in.</div>
        </div>
      </div>
      ${backButtonHtml()}`;
    wireBack();
    return;
  }

  const P = input.amount_lakh * 100000;
  const yrs = yearsRemaining(input.loan_year);
  const userEmi = emi(P, input.rate, yrs);
  const medEmi = emi(P, median, yrs);
  const diff = userEmi - medEmi;

  // Pictograph: how many out of 10 pay less than you.
  const lessCount = rates.filter(r => r < input.rate).length;
  const nLess = rates.length ? Math.round((lessCount / rates.length) * 10) : 0;

  const fellBackNote = cohort.fell_back
    ? `<div class="section-sub" style="text-align:center;margin:2px 0 14px">
         Not enough ${input.loan_year} reports for ${esc(input.bank)} yet — this compares you
         against ${esc(input.bank)} across all years.</div>`
    : '';

  const cohortLabel = cohort.fell_back ? 'Bank median · all years' : 'Cohort median';

  let leadHtml;
  if (diff > 0) {
    leadHtml = `
      <div class="kicker">Every month, you hand over this much more than they do:</div>
      <div class="big">${inr(diff)}</div>
      <div class="big-sub">that's ${inr(diff * 12)} a year, at ${input.rate.toFixed(2)}% vs a
        median of ${median.toFixed(2)}% over ${yrs} years remaining</div>`;
  } else if (diff < 0) {
    leadHtml = `
      <div class="kicker">Plenty of people who check are already paying a fair rate — and you're one of them.</div>
      <div class="big fair">${inr(-diff)}/mo better</div>
      <div class="big-sub">you pay ${input.rate.toFixed(2)}% against a median of
        ${median.toFixed(2)}% — ${inr(-diff * 12)} a year in your pocket</div>`;
  } else {
    leadHtml = `
      <div class="kicker">You're paying a fair rate.</div>
      <div class="big fair">Right at the median</div>
      <div class="big-sub">${input.rate.toFixed(2)}%, level with everyone else in this cohort</div>`;
  }

  app.innerHTML = `
    <div class="card">
      <div class="result-lead">${leadHtml}</div>
    </div>

    ${fellBackNote}

    <div class="card">
      <div class="emi-pair">
        <div class="emi-box you">
          <div class="lbl">Your EMI</div>
          <div class="val">${inr(userEmi)}</div>
          <div class="sub">${input.rate.toFixed(2)}% · ${esc(input.rate_type)}</div>
        </div>
        <div class="emi-box">
          <div class="lbl">${cohortLabel}</div>
          <div class="val">${inr(medEmi)}</div>
          <div class="sub">${median.toFixed(2)}% · ${cohort.n} report${cohort.n === 1 ? '' : 's'}</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="picto-line"><b>${nLess}</b> out of 10 people with your loan pay less than you.</div>
      ${pictographHtml(nLess)}
    </div>

    <div class="card" style="padding:0;overflow:hidden">
      <details class="dotwrap">
        <summary>See the full spread</summary>
        <div class="dotplot">
          <div class="cap">Every rate in this cohort. Yours is highlighted.</div>
          ${dotPlotSvg(rates, input.rate, median)}
        </div>
      </details>
    </div>

    ${backButtonHtml()}`;

  wireBack();
}

function pictographHtml(nLess) {
  let s = '<div class="picto">';
  for (let i = 0; i < 10; i++) {
    const less = i < nLess;
    s += `<div class="p ${less ? 'less' : 'more'}" aria-hidden="true">${less ? '○' : '●'}</div>`;
  }
  return s + '</div>';
}

function dotPlotSvg(rates, userRate, median) {
  const W = 100, H = 46;
  const lo = 6, hi = 15;
  const x = v => ((v - lo) / (hi - lo)) * W;
  const baseY = 30;

  // Jitter overlapping points a little vertically so the shape reads.
  const seen = {};
  const dots = rates.map(r => {
    const key = r.toFixed(2);
    const k = (seen[key] = (seen[key] || 0) + 1);
    const dy = ((k - 1) % 5) * 3.2;
    const isUser = Math.abs(r - userRate) < 0.005 && k === 1; // mark one as "you"
    return { cx: x(r), cy: baseY - dy, isUser };
  });
  // Make sure at least one dot at the user's rate is highlighted.
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
  const clampLbl = v => Math.max(4, Math.min(96, v)); // keep end labels off the edge
  const ticks = [6, 9, 12, 15].map(t =>
    `<text x="${clampLbl(x(t)).toFixed(1)}" y="44" font-size="3.2" fill="var(--muted)"
       text-anchor="middle">${t}%</text>`).join('');

  return `
    <svg viewBox="0 0 ${W} ${H}" width="100%" role="img"
         aria-label="Distribution of rates in this cohort">
      <line x1="0" y1="33" x2="${W}" y2="33" stroke="var(--line)" stroke-width="0.5"/>
      <line x1="${medX.toFixed(2)}" y1="6" x2="${medX.toFixed(2)}" y2="33"
            stroke="var(--muted)" stroke-width="0.5" stroke-dasharray="1.5 1.5"/>
      <text x="${medX.toFixed(2)}" y="5" font-size="3.2" fill="var(--muted)"
            text-anchor="middle">median</text>
      ${circles}
      ${ticks}
    </svg>`;
}

function backButtonHtml() {
  return `<button class="btn btn-ghost" id="f-back">← Back to the registry</button>`;
}
function wireBack() {
  const b = document.getElementById('f-back');
  if (b) b.addEventListener('click', renderLanding); // re-renders only; never re-submits
}

// ===========================================================================
// Error / config states
// ===========================================================================
function renderConfigError() {
  tallyEl.textContent = '';
  app.innerHTML = `
    <div class="card">
      <div class="thin" style="padding:24px 4px">
        <b>Not configured yet.</b><br/>
        Copy <code>config.example.js</code> to <code>config.js</code> and add your
        Supabase URL and anon key. See the README.
      </div>
    </div>`;
}
function renderLoadError(e) {
  console.error('[whatiff] load failed:', e);
  app.innerHTML = `
    <div class="card">
      <div class="thin" style="padding:24px 4px">
        Couldn't reach the registry just now. Please refresh in a moment.
      </div>
    </div>
    ${formHtml()}`;
  wireForm();
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
renderLanding();
