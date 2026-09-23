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
    'IDBI Bank', 'Yes Bank', 'IndusInd Bank', 'Federal Bank',
  ] },
  { label: 'Housing finance / NBFCs', items: [
    'LIC Housing', 'PNB Housing', 'Bajaj Housing', 'Tata Capital', 'Godrej Housing',
    'Aadhar Housing Finance', 'Home First Finance', 'Repco Home Finance',
    'Piramal Finance', 'Sundaram Home Finance',
  ] },
  { label: 'Other', items: ['Other'] },
];
const BANKS = BANK_GROUPS.flatMap(g => g.items);
const AMOUNTS = [
  { v: 2, label: '₹2 lakh' }, { v: 5, label: '₹5 lakh' }, { v: 10, label: '₹10 lakh' },
  { v: 20, label: '₹20 lakh' }, { v: 35, label: '₹35 lakh' }, { v: 50, label: '₹50 lakh' },
  { v: 75, label: '₹75 lakh' }, { v: 100, label: '₹1 crore' }, { v: 150, label: '₹1.5 crore' },
  { v: 200, label: '₹2 crore' }, { v: 300, label: '₹3 crore' }, { v: 500, label: '₹5 crore' },
  { v: 750, label: '₹7.5 crore' }, { v: 1000, label: '₹10 crore' }, { v: 1500, label: '₹15 crore' },
  { v: 2000, label: '₹20 crore' },
];
const RATE_TYPES = ['Floating', 'Fixed'];
const CHANNELS = ['Branch', 'Agent or DSA', 'Online', 'Builder tie-up', "Don't remember"];
const EMPLOYMENT = ['Salaried', 'Self-employed'];
// CIBIL score bands — the dimension that most explains "same profile, different
// rate" (banks price the spread below RLLR mainly off the score). Must match the
// cibil_allowed check constraint in migration 0007 exactly. 'Not sure' is the
// escape hatch so the field is answerable without looking a score up.
const CIBIL_BANDS = ['800+', '750-799', '700-749', 'Below 700', 'Not sure'];
// Original loan tenure (years). Used with the year-taken to get the ACTUAL years
// remaining — so "you'd save X over the life of the loan" isn't a 20-year guess.
const TENURES = [10, 15, 20, 25, 30];
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
// Years left = the sanctioned tenure minus the years since it was taken (never
// negative). We now ASK the tenure, so this is real, not a 20-year assumption.
function yearsRemaining(loanYear, tenureYears) {
  const t = tenureYears || 20;
  return Math.max(0, t - (2026 - loanYear));
}

// Outstanding balance. If the borrower told us what they still owe, use that.
// Otherwise estimate it by amortising the ORIGINAL amount at their rate over the
// ACTUAL sanctioned tenure for the months elapsed — an estimate that assumes no
// prepayment, and is labelled as such in the result.
function outstandingBalance(principal, annualRate, loanYear, tenureYears) {
  const nTotal = (tenureYears || 20) * 12;
  const r = annualRate / 1200;
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
let authUser = null;        // Supabase Auth user when signed in; identity for anti-spam only, never shown
let formState = { rate_type: null, employment: null };  // segmented-control selections (module-level so drafts can save them)

// ===========================================================================
// AUTH — sign-in gates ONLY submitting a rate (reads stay open). Identity is
// derived server-side from the login token; the UI never shows a name or email.
// The whole point is anti-spam / anti-Sybil: one verified account = one identity.
// ===========================================================================
const DRAFT_KEY = 'whatiff_form_draft';

function elVal(id) { const el = document.getElementById(id); return el ? el.value : ''; }
function authMsg(msg) { const el = document.getElementById('auth-msg'); if (el) el.textContent = msg || ''; }

// Eye icon for the show/hide password toggle (open = password currently visible).
function eyeSvg(open) {
  return open
    ? `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10 10 0 0 1 12 20C5 20 1 12 1 12a18 18 0 0 1 5.06-5.94M9.9 4.24A9 9 0 0 1 12 4c7 0 11 8 11 8a18 18 0 0 1-2.16 3.19"/><path d="M1 1l22 22"/></svg>`
    : `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>`;
}
function togglePassword() {
  const inp = document.getElementById('auth-pass');
  const btn = document.getElementById('auth-pass-toggle');
  if (!inp || !btn) return;
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  btn.innerHTML = eyeSvg(show);
  btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
}

// Persist the in-progress form so a Google sign-in redirect doesn't lose it.
function saveDraft() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      bank: elVal('f-bank'), rate: elVal('f-rate'), year: elVal('f-year'),
      amt: elVal('f-amt'), chan: elVal('f-chan'), cibil: elVal('f-cibil'),
      rate_type: formState.rate_type, employment: formState.employment,
    }));
  } catch (e) {}
}
function loadDraft() { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { return null; } }
function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch (e) {} }

// Refill the form from a saved draft (used after the Google redirect returns).
function restoreDraft() {
  const d = loadDraft();
  if (!d) return;
  const set = (id, v) => { const el = document.getElementById(id); if (el && v) el.value = v; };
  set('f-bank', d.bank); set('f-rate', d.rate); set('f-year', d.year);
  set('f-amt', d.amt); set('f-chan', d.chan); set('f-cibil', d.cibil);
  if (d.rate_type) {
    formState.rate_type = d.rate_type;
    document.querySelectorAll('#f-type .opt').forEach(o => o.classList.toggle('on', o.dataset.type === d.rate_type));
  }
  if (d.employment) {
    formState.employment = d.employment;
    document.querySelectorAll('#f-emp .opt').forEach(o => o.classList.toggle('on', o.dataset.emp === d.employment));
  }
}

async function signInGoogle() {
  if (!sb) return;
  saveDraft();
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: location.origin + location.pathname },
  });
  if (error) authMsg(error.message);
}
async function signUpEmail() {
  if (!sb) return;
  const email = elVal('auth-email').trim(), pass = elVal('auth-pass');
  if (!validEmail(email)) return authMsg('Enter a valid email address.');
  if (pass.length < 8) return authMsg('Choose a password of at least 8 characters.');
  authMsg('Creating your account…');
  const { data, error } = await sb.auth.signUp({ email, password: pass });
  if (error) {
    if (/already registered|already exists|user already/i.test(error.message || '')) {
      return authMsg('You already have an account with this email — click "Sign in" instead.');
    }
    return authMsg(error.message || 'Could not create the account.');
  }
  if (data && data.session) { authUser = data.user; onAuthed(); }        // email confirmation off
  else authMsg('Account created — click "Sign in" to continue.');         // no session returned
}
async function signInEmail() {
  if (!sb) return;
  const email = elVal('auth-email').trim(), pass = elVal('auth-pass');
  if (!validEmail(email)) return authMsg('Enter a valid email address.');
  authMsg('Signing in…');
  const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
  if (error) return authMsg(error.message || 'Could not sign in. Check your email and password.');
  authUser = data.user; onAuthed();
}
async function signOut() {
  if (!sb) return;
  try { await sb.auth.signOut(); } catch (e) {}
  authUser = null; refreshAuthUI();
}

// Called after a successful sign-in. The form values are still on screen (email
// path) or restored (Google path), so we just reveal the submit button again.
function onAuthed() {
  clearDraft();
  const panel = document.getElementById('auth-panel');
  if (panel) panel.hidden = true;
  refreshAuthUI();
  showError('');
  authMsg('');
}

// Reflect auth state in the form: a quiet "signed in (anonymous)" line, and
// whether the sign-in panel or the submit button is the active affordance.
function refreshAuthUI() {
  const status = document.getElementById('auth-status');
  if (status) {
    status.innerHTML = authUser
      ? `Signed in · your entry stays <b>anonymous</b> · <a href="#" id="auth-signout">sign out</a>`
      : '';
    const so = document.getElementById('auth-signout');
    if (so) so.addEventListener('click', (e) => { e.preventDefault(); signOut(); });
  }
}

function authPanelHtml() {
  return `
    <div class="auth-panel" id="auth-panel" hidden>
      <div class="auth-lead"><b>Sign in to add your rate.</b> We use this only to keep out spam and fake numbers —
        your rate is shared <b>anonymously</b> and your name is never shown to anyone.</div>
      <button class="btn auth-google" id="auth-google" type="button">Continue with Google</button>
      <div class="auth-or"><span>or use email</span></div>
      <input id="auth-email" type="email" inputmode="email" placeholder="you@example.com" autocomplete="email" />
      <div class="pass-wrap">
        <input id="auth-pass" type="password" placeholder="Password (8+ characters)" autocomplete="current-password" />
        <button type="button" class="pass-toggle" id="auth-pass-toggle" aria-label="Show password">${eyeSvg(false)}</button>
      </div>
      <div class="auth-btns">
        <button class="btn" id="auth-signin" type="button">Sign in</button>
        <button class="btn btn-ghost" id="auth-signup" type="button">Create account</button>
      </div>
      <div class="auth-msg" id="auth-msg"></div>
    </div>`;
}

function wireAuth() {
  restoreDraft();
  refreshAuthUI();
  const g = document.getElementById('auth-google'); if (g) g.addEventListener('click', signInGoogle);
  const si = document.getElementById('auth-signin'); if (si) si.addEventListener('click', signInEmail);
  const su = document.getElementById('auth-signup'); if (su) su.addEventListener('click', signUpEmail);
  const pt = document.getElementById('auth-pass-toggle'); if (pt) pt.addEventListener('click', togglePassword);
}

// ===========================================================================
// LANDING
// ===========================================================================
async function renderLanding() {
  if (!sb) return renderConfigError();
  app.innerHTML = `<div class="thin" style="padding:36px 4px">Loading the registry…</div>`;

  let total = 0, stats = null;
  try {
    const st = await sb.rpc('registry_stats');
    if (st.error) throw st.error;
    stats = (st.data && st.data[0]) || { n_rates: 0, tracked_lakh: 0, potential_saving_total: 0 };
    total = stats.n_rates || 0;
  } catch (e) { return renderLoadError(e); }

  tallyEl.innerHTML = total > 0
    ? `<b>${total.toLocaleString('en-IN')}</b> rates shared`
    : `Be the first to share a rate`;
  footEl.innerHTML = 'Anonymous to everyone. Adding a rate needs a quick sign-in (spam control only) — your name is never shown. Aggregates only; individual rates and contact details are never displayed.';

  app.innerHTML = `
    <section class="hero-card">
      <div class="hero-copy">
        <div class="eyebrow">Anonymous home-loan rate registry</div>
        <h1>Banks advertise a rate almost nobody gets.</h1>
        <p>Borrowers are telling each other what they actually got — so you can see what's achievable at your bank, not just what's on the brochure, and which one move is worth making.</p>
        <button class="btn hero-cta" id="hero-cta" type="button">See what's achievable <span class="arr">→</span></button>
        <div class="hero-note"><b>Free.</b> No login to browse · your name is never shown.</div>
      </div>
      <div class="hero-coins" aria-hidden="true">${coinsCluster()}</div>
    </section>

    ${trustStrip(stats)}

    <div class="form-solo">
      ${formHtml()}
    </div>

    ${howItWorks()}

    <div class="land-closing">
      <h3>See what's achievable at your bank.</h3>
      <p>It takes under a minute, it's free, and a lower rate might be one conversation away.</p>
      <button class="btn hero-cta" id="closing-cta" type="button">Add your rate <span class="arr">→</span></button>
    </div>
  `;
  const scrollToForm = () => {
    const t = document.getElementById('addrate');
    if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const bank = document.getElementById('f-bank');
    if (bank) setTimeout(() => bank.focus({ preventScroll: true }), 400);
  };
  ['hero-cta', 'nav-cta', 'closing-cta'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', scrollToForm);
  });
  wireForm();
}

// ₹ crore, sensibly rounded for a headline figure.
function inrCrore(rupees) {
  const cr = rupees / 1e7;
  if (cr <= 0) return '₹0';
  const val = cr >= 100 ? Math.round(cr).toLocaleString('en-IN')
            : cr >= 10 ? cr.toFixed(0)
            : cr >= 1 ? cr.toFixed(1)
            : cr.toFixed(2);
  return `₹${val} Cr`;
}

// The trust strip. Below 10 rows the real numbers are too small to impress, so
// we show honest value-props until there's enough volume, then flip to live
// stats (rates shared · loans tracked · potential savings IDENTIFIED, never
// "saved"). Matches the leaderboard's own ≥10 threshold.
function trustStrip(stats) {
  const n = stats ? (stats.n_rates || 0) : 0;
  if (n < 10) {
    return `
      <div class="trust">
        <div class="t"><b>100% anonymous</b>Your name is never shown to anyone</div>
        <div class="t"><b>25 lenders tracked</b>Rates verified against official rate cards</div>
        <div class="t"><b>No login to browse</b>Sign in only to add your own rate</div>
      </div>`;
  }
  const trackedCr = inrCrore((stats.tracked_lakh || 0) * 1e5);
  const savedCr = inrCrore(stats.potential_saving_total || 0);
  return `
    <div class="trust tnum">
      <div class="t"><b>${n.toLocaleString('en-IN')}</b>rates shared by borrowers</div>
      <div class="t"><b>${trackedCr}</b>in home loans tracked</div>
      <div class="t"><b>${savedCr}</b>in potential savings identified</div>
    </div>`;
}

function howItWorks() {
  return `
    <section class="how">
      <div class="shead"><span class="eyebrow">How it works</span><h2>Three steps, under a minute</h2></div>
      <div class="steps">
        <div class="step"><div class="num">STEP 1</div><h3>Share your rate</h3><p>Tell us your bank, rate and a few loan details. It's anonymous — a quick sign-in only keeps out spam, and your name is never shown.</p></div>
        <div class="step"><div class="num">STEP 2</div><h3>See where you stand</h3><p>We compare you against borrowers like you — same bank, credit band and loan size — and show what the better-priced ones actually pay.</p></div>
        <div class="step"><div class="num">STEP 3</div><h3>Know your one move</h3><p>Get the single most worthwhile action — reprice with your bank, or switch — with the real numbers and what to ask for.</p></div>
      </div>
    </section>`;
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
  const cibilOpts = CIBIL_BANDS.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  const tenureOpts = TENURES.map(t => `<option value="${t}">${t} years</option>`).join('');
  const typeOpts = RATE_TYPES.map(t => `<div class="opt" data-type="${t}">${t}</div>`).join('');
  const empOpts = EMPLOYMENT.map(e => `<div class="opt" data-emp="${e}">${e}</div>`).join('');

  return `
    <div class="card" id="addrate">
      <div class="form-title">Add your rate</div>
      <div class="form-sub">A minute, no phone, no email. Anonymous — your name is never shown.</div>

      <div class="form-grid">
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
        <label for="f-amt">Loan amount <span class="opt-tag">when you took it</span></label>
        <select id="f-amt"><option value="" disabled selected>Choose an amount</option>${amtOpts}</select>
      </div>
      <div class="field">
        <label for="f-tenure">Loan tenure <span class="opt-tag">the term you signed up for</span></label>
        <select id="f-tenure"><option value="" disabled selected>Choose tenure</option>${tenureOpts}</select>
      </div>
      <div class="field">
        <label for="f-out">Amount you still owe <span class="opt-tag">optional — in ₹ crore</span></label>
        <input id="f-out" type="number" inputmode="decimal" step="0.05" min="0" placeholder="e.g. 0.45 · leave blank and we'll estimate" />
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
      <div class="field">
        <label for="f-cibil">Credit score (CIBIL) when you took the loan</label>
        <select id="f-cibil"><option value="" disabled selected>Choose a band</option>${cibilOpts}</select>
      </div>
      </div>

      <button class="btn" id="f-submit">See what's achievable at your bank</button>
      <div class="auth-status" id="auth-status"></div>
      ${authPanelHtml()}
      <div class="form-error" id="f-error"></div>
    </div>`;
}

function wireForm() {
  formState = { rate_type: null, employment: null };
  document.querySelectorAll('#f-type .opt').forEach(el => el.addEventListener('click', () => {
    document.querySelectorAll('#f-type .opt').forEach(o => o.classList.remove('on'));
    el.classList.add('on'); formState.rate_type = el.dataset.type;
  }));
  document.querySelectorAll('#f-emp .opt').forEach(el => el.addEventListener('click', () => {
    document.querySelectorAll('#f-emp .opt').forEach(o => o.classList.remove('on'));
    el.classList.add('on'); formState.employment = el.dataset.emp;
  }));
  document.getElementById('f-submit').addEventListener('click', () => submit(formState));
  wireAuth();
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
  const cibil_band = document.getElementById('f-cibil').value;
  const tenure_years = parseInt(document.getElementById('f-tenure').value, 10);
  const outRaw = document.getElementById('f-out').value.trim();
  // Field is in ₹ crore; convert to lakh (1 crore = 100 lakh) for the internal math.
  const outstanding_cr = outRaw === '' ? null : parseFloat(outRaw);
  const outstanding_lakh = outstanding_cr == null ? null : Math.round(outstanding_cr * 100 * 100) / 100;

  if (!bank) return showError('Pick your bank.');
  if (!(rate >= 6 && rate <= 15)) return showError('Enter a rate between 6% and 15%.');
  if (!loan_year) return showError('Pick the year you took the loan.');
  if (!amount_lakh) return showError('Pick a loan amount.');
  if (!tenure_years) return showError('Pick your loan tenure.');
  if (outstanding_cr != null && !(outstanding_cr > 0 && outstanding_lakh <= amount_lakh))
    return showError('Amount still owed should be between 0 and your loan amount — or leave it blank.');
  if (!rate_type) return showError('Pick floating or fixed.');
  if (!channel) return showError('Pick how you got the loan.');
  if (!employment) return showError('Pick salaried or self-employed.');
  if (!cibil_band) return showError('Pick your credit-score band.');

  // Gate ONLY submitting behind sign-in (reads stay open). Form is validated
  // first, so we ask for sign-in once, at the end, on a complete entry.
  if (!authUser) {
    const panel = document.getElementById('auth-panel');
    if (panel) { panel.hidden = false; panel.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    return showError('One last step — sign in to add your rate. Your entry stays anonymous.');
  }

  const input = { loan_type: 'Home', bank, rate: Math.round(rate * 100) / 100,
                  loan_year, amount_lakh, rate_type, channel, employment, cibil_band,
                  tenure_years, outstanding_lakh };

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
      p_channel: channel, p_employment: employment, p_cibil_band: cibil_band,
    });
    if (ins.error) throw ins.error;
    currentRateId = ins.data;
    lastPayload = payloadKey;
    outcomeId = null;
    if (window.umami) window.umami.track('Submission');

    const [cs, br, bm, rm] = await Promise.all([
      sb.rpc('cohort_stats', {
        p_loan_type: 'Home', p_bank: bank, p_year: loan_year,
        p_channel: channel, p_employment: employment, p_cibil_band: cibil_band,
        p_amount_lakh: amount_lakh,
      }),
      sb.rpc('bank_rates', { p_loan_type: 'Home' }),
      sb.rpc('bank_benchmark', { p_bank: bank }),
      // Pricing context: markup over the RBI policy repo rate. Non-null only for
      // repo-linked (RLLR) loans; NULL for HFC/PLR/unresolved (then no line shows).
      sb.rpc('get_repo_markup', { p_report_id: currentRateId }),
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

    const repoMarkup = (rm && !rm.error && rm.data != null) ? Number(rm.data) : null;

    lastResult = { input, cohort, bestBankP25, benchmark, fees, repoMarkup };
    renderResult(lastResult);
  } catch (e) {
    submitting = false; btn.disabled = false; btn.textContent = 'See what\'s achievable at your bank';
    const msg = String(e && e.message || e);
    if (msg.includes('auth_required')) {
      authUser = null; refreshAuthUI();
      const panel = document.getElementById('auth-panel');
      if (panel) { panel.hidden = false; panel.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      showError('Your sign-in expired — please sign in again to add your rate.');
    }
    else if (msg.includes('session_revoked')) showError("This account has been blocked from posting after several out-of-range entries. If you think that's a mistake, reach out and we'll take a look.");
    else if (msg.includes('rate_limit_exceeded')) showError("You've shared a lot in the last day — take a break and come back later.");
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
  const tenure = input.tenure_years || 20;
  const yrs = yearsRemaining(input.loan_year, tenure);
  const balanceEntered = input.outstanding_lakh != null;
  const outstanding = balanceEntered
    ? input.outstanding_lakh * 100000
    : outstandingBalance(principal, input.rate, input.loan_year, tenure);
  const balanceNote = balanceEntered
    ? 'Based on the balance you entered.'
    : `Estimated balance — assumes no prepayment on your ${tenure}-year loan.`;
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

  // Confidence from cohort depth (ties to the 0012 DISPLAY_THRESHOLD idea).
  const cohortConf = cohort.n >= 30 ? 'high' : cohort.n >= 8 ? 'medium' : 'low';

  // Door 2 — reprice with the SAME lender. Target basis is EXPOSED, not silent
  // (docs/rate-migration-spec.md §7.1). Basis 'cohort_p25' = the better-priced
  // quarter of similar borrowers at this bank; within one lender this equals
  // "benchmark + cohort spread P25", so it upgrades cleanly to a benchmark-derived
  // basis once an RLLR series exists. We use cohort P25 (realised, non-overstating)
  // rather than the bank's advertised floor, which is best-case marketing.
  let door2 = null;
  if (cohortP25 != null) {
    const cost = convCost(outstanding);
    const gross = cohortP25 < input.rate ? iUser - interestOver(outstanding, cohortP25, yrs) : 0;
    door2 = { target: cohortP25, cost, gross, net: gross - cost, feeVerified: convVerified,
              noGap: !(cohortP25 < input.rate), basis: 'cohort_p25', confidence: cohortConf };
  }

  // Door 3 — balance transfer to a competing lender. Counterfactual, its own cost
  // stack + eligibility. Basis exposed: the cheapest lender in our data for this
  // profile (a realised p25), subject to the switching costs and eligibility.
  let door3 = null;
  if (bestBankP25 != null) {
    const cost = procCost(outstanding) + outstanding * BT_MOD_PCT + BT_LEGAL_TECH;
    const gross = bestBankP25 < input.rate ? iUser - interestOver(outstanding, bestBankP25, yrs) : 0;
    door3 = { target: bestBankP25, cost, gross, net: gross - cost, feeVerified: procVerified,
              noGap: !(bestBankP25 < input.rate), basis: 'best_bank_p25',
              confidence: procVerified ? 'medium' : 'low' };
  }

  return { outstanding, yrs, iUser, cohortP25, door2, door3, balanceEntered, balanceNote, tenure };
}

function renderResult(res) {
  window.scrollTo(0, 0);
  const { input, cohort, bestBankP25, benchmark, fees, repoMarkup } = res;
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

  // Loan essentially at its end — no move can pay for itself over what's left.
  if (calc.yrs < 1) {
    app.innerHTML = `
      <div class="card">
        <div class="result-lead">
          <div class="frame">Your ${esc(input.bank)} loan is at the end of its ${calc.tenure}-year term —
            there's little left to save by switching now.</div>
          <div class="caveat">Repricing or a balance transfer only pays off when there are years of interest left to save. Your rate is still on record and counts toward the registry.</div>
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

  // ---- Economic conclusion is the organizing principle (not the peer compare) ----
  // Similar-borrowers range = cohort P25–P75 (the price band others actually report).
  const p25 = calc.cohortP25;
  const p75 = cohort.p75_rate != null ? Number(cohort.p75_rate)
            : (rates.length ? Math.max(...rates) : p25);
  const simRange = p25.toFixed(2) === p75.toFixed(2)
    ? `${p25.toFixed(2)}%`
    : `${p25.toFixed(2)}%–${p75.toFixed(2)}%`;

  // "Above your bank's better-priced peers" drives state 1 vs state 2. It is a
  // peer fact (rate vs cohort P25), never a repo_markup claim — no "overpaying".
  const aboveBankPeers = calc.door2 ? !calc.door2.noGap : (input.rate > p25);
  const recDoor = rec === 'door1' ? null : (rec === 'door2' ? calc.door2 : calc.door3);
  // Record the identified potential saving (fire-and-forget) for the landing
  // stat. Capped server-side; only ever "identified", never claimed as "saved".
  if (recDoor && recDoor.net > 0 && currentRateId != null && sb) {
    try { sb.rpc('record_potential', { p_rate_id: currentRateId, p_saving: Math.round(recDoor.net) }); } catch (e) {}
  }
  let headline, headClass, heroLead;
  if (rec === 'door1') {
    headline = "There's probably nothing worth changing.";
    headClass = 'neutral';
    heroLead = aboveBankPeers
      ? `A lower rate exists for people like you, but the cost of switching would outweigh it right now.`
      : `Your rate holds up well against people like you — no move here would pay for itself today.`;
  } else {
    headline = aboveBankPeers
      ? 'It may be worth acting on your loan.'
      : 'Your rate is competitive, but switching could still save you money.';
    headClass = 'act';
    const verb = rec === 'door3' ? 'by switching lenders' : 'by asking your bank to reprice';
    heroLead = `You could save about <b>${inr(recDoor.net)}</b> over what's left of your loan ${verb}.`;
  }
  const doorsTitle = rec === 'door1' ? 'The economics right now' : 'What you can do about it';
  const amtLabel = (AMOUNTS.find(a => a.v === input.amount_lakh) || {}).label || ('₹' + input.amount_lakh + ' lakh');
  const chips = [amtLabel, 'Taken ' + input.loan_year, input.employment, 'CIBIL ' + input.cibil_band, input.rate_type]
    .map(c => `<span class="chip">${esc(c)}</span>`).join('');
  const diffTile = monthlyDiff > 0
    ? `<div class="kpi flag"><div class="k-lbl">You pay more</div><div class="k-val">${inr(monthlyDiff)}</div><div class="k-sub">a month, on what you owe</div></div>`
    : `<div class="kpi"><div class="k-lbl">Vs peers</div><div class="k-val">On par</div><div class="k-sub">priced like similar borrowers</div></div>`;
  const medianForPlot = Number(cohort.median_rate == null ? calc.cohortP25 : cohort.median_rate);

  app.innerHTML = `
    <div class="rgrid">
      <div class="verdict ${headClass}">
        <div class="reyebrow">Your result · ${esc(input.bank)} home loan</div>
        <h1>${headline}</h1>
        <p class="v-lead">${heroLead}</p>
        <div class="chips">${chips}</div>
        <div class="v-coin"></div><div class="v-coin two"></div>
      </div>

      <div class="kpis tnum">
        <div class="kpi">
          <div class="k-lbl">You pay</div>
          <div class="k-val">${input.rate.toFixed(2)}%</div>
          <div class="k-sub">${inr(userEmi)} a month</div>
        </div>
        <div class="kpi">
          <div class="k-lbl">Similar borrowers</div>
          <div class="k-val">${simRange}</div>
          <div class="k-sub">${cohort.n} report${cohort.n === 1 ? '' : 's'}${cohort.tier > 1 ? ' · widened' : ''}</div>
        </div>
        ${diffTile}
        <div class="kpi">
          <div class="k-lbl">Peers paying less</div>
          <div class="k-val">${nLess} / 10</div>
          <div class="k-sub">at ${esc(input.bank)} report lower</div>
        </div>
      </div>

      <section class="rband">
        <div class="sec-head"><span class="reyebrow">${doorsTitle}</span></div>
        <div class="action-wrap">
          ${doorHtml(Number(rec.slice(4)), rec, calc)}
          ${rec !== 'door1' ? `<div class="fee-disclaimer">Fee figures are <b>estimates</b> — from each lender's official documents where published, and third-party sources where they don't. Charges vary by profile, so <b>verify the exact fees with your bank</b> before acting.</div>` : ''}
        </div>
      </section>

      <section class="rband">
        <div class="sec-head"><span class="reyebrow">The evidence</span><h2>Where you sit among people like you</h2></div>
        <div class="evidence">
          <div class="panel">
            <h4>Every rate people like you reported</h4>
            <div class="p-note">${cohort.tier > 1 ? esc(cohort.tier_label) : esc(cohortLine)} Yours is marked.</div>
            <div class="dotplot">${dotPlotSvg(rates, input.rate, medianForPlot)}</div>
            ${pictographHtml(nLess)}
            <div class="p-note"><b>${nLess} out of 10</b> ${esc(input.bank)} borrowers report a lower rate than yours. Rates differ by credit score, employer and how you applied — so yours may differ for good reasons.</div>
          </div>
          <div class="panel">
            <h4>The context</h4>
            <div class="ctx">
              ${repoMarkupLine(input, repoMarkup)}
              ${benchmarkLine(input, benchmark)}
              <div class="ctx-note"><span class="c-lbl">How close this match is</span><div class="c-val">Compared against <b>${cohort.n} ${esc(input.bank)} ${esc(input.employment.toLowerCase())} borrower${cohort.n === 1 ? '' : 's'}</b>${cohort.tier > 1 ? ' — widened to a broader group' : ' in your score and loan-size band'}. We never show a figure from fewer than four.</div></div>
            </div>
          </div>
        </div>
      </section>

      <div class="closing">
        <h3>This is what borrowers like you actually report — not a brochure rate.</h3>
        <div class="c-btns">
          <button class="btn cbtn" id="f-again" type="button">Add another rate</button>
          <button class="btn btn-ghost cbtn" id="f-back" type="button">← Back to the registry</button>
        </div>
      </div>

      <div class="r-footnote">Your rate is shared anonymously — your name is never shown to anyone. WhatIff shows what's achievable at your bank, not that you were charged unfairly.</div>
    </div>`;

  wireDoors();
  wireBack();
  const again = document.getElementById('f-again'); if (again) again.addEventListener('click', renderLanding);
}

// Provenance line for a door's target rate — the basis is EXPOSED, never a bare
// number (docs/rate-migration-spec.md §6a / §7). Kept subordinate; the saving and
// net benefit stay the headline.
function doorBasisLine(d) {
  const t = (d && d.target != null) ? d.target.toFixed(2) + '%' : '';
  if (d.basis === 'cohort_p25')
    return `<div class="door-basis">Target ${t} — what the better-priced quarter of similar borrowers at your bank report. A peer estimate, not a quote.</div>`;
  if (d.basis === 'best_bank_p25')
    return `<div class="door-basis">Target ${t} — the cheapest lender in our data for a profile like yours, subject to eligibility and the costs above.</div>`;
  return '';
}

function doorHtml(n, rec, calc) {
  const isRec = rec === `door${n}`;
  const tag = isRec ? `<div class="dtag">Recommended</div>` : '';

  if (n === 1) {
    return `
      <div class="door ${isRec ? 'rec' : ''}">
        ${tag}
        <h3>Nothing to do right now</h3>
        <div class="net none">The savings wouldn't cover the cost of switching right now. Worth checking again if RBI cuts rates or your bank changes its spread.</div>
      </div>`;
  }

  if (n === 2) {
    const d = calc.door2;
    if (!d) return '';
    if (d.noGap) {
      return `
        <div class="door ${isRec ? 'rec' : ''}">
          ${tag}
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
        ${tag}
        <h3>Ask your bank to convert your spread</h3>
        <div class="dsub">In plain words: get your bank to put today's lower rate on your existing loan — no new loan, no longer tenure.</div>
        <div class="net">You'd save about <b>${inr(d.net)}</b> — after a one-time fee of roughly ${inr(d.cost)}.</div>
        <div class="cost">That's ${inr(d.gross)} saved over your remaining ~${Math.round(calc.yrs)} years, minus the fee. ${d.feeVerified ? "Fee is this lender's stated charge — confirm before you commit." : "Fee is a general estimate — check with your bank."} ${calc.balanceNote}</div>
        ${doorBasisLine(d)}
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
        ${tag}
        <h3>Move to another lender</h3>
        <div class="net none">No other bank here is currently cheaper than your rate.</div>
      </div>`;
  }
  return `
    <div class="door ${isRec ? 'rec' : ''}" data-door="Transfer">
      ${tag}
      <h3>Move to another lender</h3>
      <div class="dsub">Switch your loan to a cheaper bank. There's paperwork and some upfront cost, but the savings can be big.</div>
      <div class="net">You'd save about <b>${inr(d.net)}</b> — after roughly ${inr(d.cost)} in switching costs (processing, legal, valuation, registration).</div>
      <div class="cost">That's ${inr(d.gross)} saved over your remaining ~${Math.round(calc.yrs)} years, minus those costs. ${d.feeVerified ? "Processing fee is the new lender's stated charge; legal, valuation and stamp costs are estimates — confirm before you move." : "Fees are estimates — check before you move."} ${calc.balanceNote}</div>
      ${doorBasisLine(d)}
      <div class="dbody">
        <p style="font-size:13.5px;color:var(--muted);margin-bottom:4px">Want the exact numbers for your loan — what you'd save and what to ask a new lender for? Leave your email and we'll send you the calculation. We're not a broker and we're not paid by any lender.</p>
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
    slot.innerHTML = `<div class="email-ok">✓ Got it — we'll email you.</div>`;
    return;
  }
  const label = door === 'Conversion' ? 'Email me this template' : 'Email me the calculation';
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

// Pricing context (subordinate): the borrower's markup over the RBI policy repo
// rate. Rendered ONLY for repo-linked loans, where repo_markup is non-null; HFC/
// PLR and unresolved loans pass null and show nothing (no empty box, no repo maths
// forced onto a non-repo-linked loan). Descriptive context, never a verdict.
function repoMarkupLine(input, repoMarkup) {
  if (repoMarkup == null || !isFinite(repoMarkup)) return '';
  const repo = input.rate - repoMarkup;   // exact: rate and markup are both 2-dp
  return `
    <div class="benchmark pricing-context">
      <b>Pricing context</b><br>
      Your interest rate is <b>${repoMarkup.toFixed(2)} percentage points</b> above the RBI policy repo rate of ${repo.toFixed(2)}%.
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
// Boot: resolve any existing sign-in first (so submit is gated correctly and the
// Google redirect is picked up), then render. Auth state is for anti-spam only —
// it changes nothing a viewer sees.
async function boot() {
  if (sb) {
    try {
      const { data } = await sb.auth.getSession();
      authUser = (data && data.session && data.session.user) || null;
      sb.auth.onAuthStateChange((_evt, session) => {
        authUser = (session && session.user) || null;
        refreshAuthUI();
        // Returning from the Google redirect: reveal the form again with the
        // draft restored, and hide the sign-in panel.
        const panel = document.getElementById('auth-panel');
        if (authUser && panel && !panel.hidden) { restoreDraft(); onAuthed(); }
      });
    } catch (e) { authUser = null; }
  }
  renderLanding();
}
boot();
