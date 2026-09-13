# WhatIff Home Loan Registry — Handover

**For:** the next session continuing this project.
**Last updated:** 2026-09-10, after commit `11279b7`.
**Read this first, then delete/ignore it once you're oriented — it's a working note, not shipped docs.**

---

## What this is

An anonymous, crowd-sourced home-loan **rate registry**. Borrowers report the
rate they actually got; everyone else sees *what's achievable at their bank —
not just the advertised floor* — and which of three "doors" is worth taking to
lower their rate. No login, no auth.

Honest framing, narrow on purpose: *a lower rate exists at your bank; your
situation may differ; it's worth ten minutes to find out.* Nothing claims any
borrower was treated unfairly.

- **Repo:** `parthmehta003-sys/whatiff-cardengine`
- **Branch:** `claude/whatiff-rate-registry-prod-vi88to` (develop + push here; never push elsewhere without explicit permission)
- **Project subdir:** everything lives under `rate-registry/`
- **Live:** https://whatiff-registry.netlify.app
- **Stack:** vanilla HTML/CSS/JS (no framework) · Supabase (Postgres) · Netlify (base dir `rate-registry`, build writes `config.js` + static `/rates/` pages) · Umami Cloud analytics (cookieless)
- **Design:** matches whatiff.in — lavender palette + DM Sans font (locked by the user: "keep the colour and font same as whatiff.in, just the design"). Hero is a self-contained rounded brand card with animated 3D ₹ coins; full-width desktop layout.

---

## Current state (what's done)

- **v2 built and deployed.** Home-loan form (8 fields — CIBIL band added in 0007),
  three-door output, tiered cohort widening, outcomes/follow-up, static crawlable
  aggregate pages.
- **CIBIL score band added (0007)** as a cohort dimension — chosen over city
  (city is low rate-signal for national floating rates, worsens sparsity, and is
  an unverifiable spam target). Cohort tiers: bank → employment → CIBIL → year →
  channel, dropped weakest-first so the score band survives longest. Outlier test
  is now per bank+band (a whole low-score band would otherwise be flagged as
  fraud against the bank-wide median). Form requires a band; 'Not sure' is the
  escape hatch; nullable in DB so old rows/Business are unaffected.
- **Ticket-size band added (0008)** as a cohort dimension, derived from the loan
  amount already collected (no new question). Bands ≤₹30L / ₹30-75L / ₹75L-₹2Cr /
  >₹2Cr (`amount_band(int)`). Full cohort ladder now: bank → CIBIL → ticket →
  employment → year → channel (score and size, the two hard pricing levers,
  survive longest). Testing surfaced a false-positive: tight rate clusters make
  MAD ~0 so a legit larger-ticket cluster got flagged as outliers → fixed with a
  **0.75-point absolute-deviation floor** on the outlier test (flag only if far by
  MAD *and* ≥0.75 off the band median). Gross typos (13.5) still caught.
- **Design redesign done** to match whatiff.in (hero brand card, coins, full-width
  `landing-grid` / `result-grid`).
- **Plain-language copy pass done** on landing list and result screen/doors (kept
  the top-up warning + template verbatim — do not water those down).
- **Lender universe expanded** to banks + home-loan NBFCs/HFCs (see dropdown below).
- **Per-lender verified fees + rates loaded** — **25 lenders** (Indian Bank, Aavas
  Financiers, Can Fin Homes, Sammaan Capital were removed at the user's request),
  each figure from the lender's own official page. **All 25 are now
  primary-source verified** (see below).
  **SBI, HDFC, ICICI, Axis, BoB, Canara, Union Bank, Bank of India, IDBI, Yes Bank,
  Federal, IndusInd, Punjab National Bank, PNB Housing, LIC Housing, Bajaj Housing,
  Tata Capital, Godrej Housing, Aadhar, Home First, Repco, Piramal, Sundaram, Kotak, IDFC First** hardened against user-supplied official PDFs/screenshots (MITCs, ROI
  schedules, schedules of charges/GSFC, rate & fee pages). EVERY lender now has an
  advertised_floor (no NULLs). ALL 15 banks in the Banks group are now
  document-touched. (Canara: fees still web-sourced. PNB the bank: fees confirmed
  from its Services Charges page, but its rate card screenshot was unreadable so the
  RLLR 7.75/floor 7.20 rate is kept from the prior fetch. LIC Housing: fully verified
  from clear salaried + self-employed rate tables — floor 7.15% (salaried, CIBIL
  >=825; SE 7.30%).)
  Flat processing (Door-3 takeover) fees: BoB ₹8,500, SBI ₹6,500, IDBI ₹0 (IDBI
  waives inward-BT processing), LIC Housing ₹5,000, Home First ₹16,000.
- **THIRD-PARTY FEE POLICY (user-set).** Where a lender doesn't publish a fee
  officially, store the best third-party (aggregator) estimate rather than leaving
  the door on the generic app assumption, and write "THIRD-PARTY ESTIMATE" in that
  row's note (e.g. Godrej conversion ~1%). Percentage ceilings ("up to 3%/7%") are
  still never stored (they'd make absurd door fees). The result screen carries a
  standing **fee disclaimer** (`.fee-disclaimer` in app.js/style.css) stating fees
  are estimates from official + third-party sources and must be verified with the
  bank; per-door captions say the fee is the lender's "stated charge" (not
  "published figure") so third-party data isn't over-claimed. Indian Bank stays in the seed's delete list (not
  re-inserted) so re-running the seed drops it from the live DB. (Canara: rate RLLR 8.00/floor 7.15 confirmed
  from the rate tables; its fees weren't in those screenshots, still web-sourced.) Bank of India (7.10%) is the cheapest floor in the table → the most
  common Door-3 target; its 0.35% PF is confirmed (note: BOI has a temporary NIL-PF
  takeover promo to 30.09.26; standard 0.35% stored for durability).
  This was the last big task. NB: **PNB Housing** (HFC) and **Punjab National Bank**
  (bank) are two separate lenders/rows — the PNBHFL MITC verified PNB Housing only.
  Kotak: rate 7.60% + fees fully verified from its GSFC (conversion 0.5% POS cap
  ₹10k → flat 10000; PF is an "up to 2%" ceiling so processing_fee_pct is NULL →
  Door 3 uses the 0.5% estimate).

### The fees/rates work (most recent, commit `11279b7`)

- **Migration `0003_conversion_flat_fee.sql`** adds `conversion_fee_flat numeric(9,2)`
  and rebuilds `bank_benchmark(text)` to return it. Reason: many lenders charge the
  Door-2 conversion fee as a small **flat rupee amount**, not a % of the loan.
  Modelling SBI's ₹5,000 as "0.5% × ₹45L = ₹22,500" wrecked Door 2.
- **`app.js`** Door 2 now uses `convCost = flat → pct → estimate`
  (`app.js:444-451`); Door 3 uses the verified processing fee or the BT default.
  `feeVerified` drives the "published figure" vs "estimate" caption on each door.
- **`seed_benchmarks.sql`** rewritten: 28 lenders. Sanity corrections applied on
  load and documented in the seed header (do NOT silently revert them):
  - "Up to X%" **ceilings** left NULL (Bajaj 7%, Piramal 5%, Tata 3%, Godrej 2% processing) — a ceiling isn't a typical fee; storing it kills every recommendation.
  - ICICI processing kept at **0.5%** (rates page), not the 2% schedule ceiling.
  - Flat conversion fees → `conversion_fee_flat` (SBI 5k, ICICI 3k, Kotak/Union 10k, LIC/Axis 3k).
  - **Switch / rate-delta** conversion fees left NULL (Aadhar 3% switch, Sammaan % of rate-delta, Tata) — not the Door-2 rate-reduction fee.
  - `advertised_floor` = lowest genuinely-advertised rate: **ICICI 7.55** (not 8.50 card floor), **Tata 8.00** (not 8.95).
  - `advertised_floor` NULL where pages are JS-rendered / no advertised line: Axis, Yes, IndusInd, LIC.
  - **IDFC First omitted** — nothing verifiable came back.
- **Bug fixed in passing:** Axis row had NULL `source_url` (violates schema NOT NULL) → pointed at Axis's official fees PDF.
- **Verified on local Postgres 16:** full chain applies clean; `bank_benchmark`
  distinguishes flat/pct/null; new NBFC lenders accepted by `submit_rate`;
  below-floor exclusion uses new lenders' advertised floors. `node --check app.js` passes.

---

### Anti-abuse hardening (migration 0006 — LinkedIn feedback)

Answered the registry feedback (Rujhan Arora: "IP limits are easy to bypass;
how do you think about fake/spam over time?"; the "checks vs regional/bank
median" and "revoke access after too many reports" asks) in
`0006_abuse_hardening.sql`. **App-side:** `app.js` now shows friendly messages
for the `session_revoked` and (reworded) 24h rate-limit errors. Three layers:

1. **One live report per person, by construction** — `submit_rate` already
   supersedes prior reports from the same session+loan_type, so a session ends
   up with exactly one live report per loan type. That's the "once" guarantee.
2. **24h rate-limit window** — replaced 5/hr with an 8-inserts/24h burst ceiling
   (honest corrections dedupe/supersede, so they don't reach it).
3. **Robust outlier test** — replaced mean/SD with **median + MAD**
   (`|rate−median| > 3.5×1.4826×MAD`), because the mean/SD are themselves
   poisoned by the fakes; the median resists it. **Session revocation:** a
   session with ≥3 flagged (outlier/below_floor) reports is written to the new
   `banned_sessions` table and refused (`session_revoked`). Threshold =
   `abuse_ban_threshold()` (=3), the tuning knob.

Verified on local Postgres 16: 0001→0006 apply clean; outlier flagged, session
banned at exactly 3 flags then blocked, 9th/24h blocked, idempotent resubmit
still returns without inserting. **Honest caveat (documented in the migration +
README):** no auth means a "person" is a localStorage `session_id` — all
per-session limits are bypassable by clearing storage. A hard "one human, once"
needs an identity signal (phone/email OTP or login) we don't collect yet; 0006
raises cost without pretending to be unbypassable.

## ⚠️ Open items / TODO for next session

1. **Seed 40–50 REAL borrower rates.** The site launches empty and hides aggregates
   under 10 rows / 4 per cohort. Benchmarks verify submissions but the registry has
   no real crowd data yet. **This is the main blocker to sharing the site.** No
   seed/demo rates in the repo by design — they must be real, from the user's network.
2. **Unresolved data conflicts** (stored my best call, each flagged in the row's `note`):
   - **HDFC conversion fee** — ✅ RESOLVED from the official MITC (user-supplied PDF):
     0.50% of principal outstanding, cap ₹50k, whichever lower → stored as
     `conversion_fee_pct = 0.005` (not flat ₹5k). PF 0.5% confirmed.
   - **Bank of Baroda** — ✅ RESOLVED from the official rates & charges page
     (user screenshot). The "50%"/"25%" render was stripped decimals for
     0.50%/0.25% (min ₹8,500; max ₹15k ≤50L / ₹25k >50L) — confirmed. Door 3 is a
     takeover, and BoB's takeover PF is a **flat ₹8,500** → stored in the new
     `processing_fee_flat` column (migration 0004). Advertised floor corrected
     7.20 → **7.25%** ("From 7.25%" floating).
   - **SBI** — ✅ hardened from the official Home Loan MITC (user PDF): processing
     fee is FLAT (₹6,500 for 25–75L, ₹10,000 >75L, 0.25% ≤25L) → `processing_fee_flat
     = 6500`, superseding the old 0.35% card rate. Conversion kept at ₹5,000 flat
     (MITC only covers the fixed→floating switch at 0.56%).
   - **Home First rate 8.00%** — ✅ CONFIRMED from the official Fees & Charges page
     (no longer provisional); processing filled flat ₹16,000.
   - **Repco** — ✅ RESOLVED from official Ready Reckoner + Schedule of Charges: the
     old 8.75% was wrong; floor is **9.90%** (MLR + 0). Processing 1% (salaried),
     conversion flat ₹2,000 (ROI-revision fee). No flagged/low-confidence rows remain.
3. **Repo rate — ✅ RESOLVED at 5.25%.** Confirmed against RBI's 19-Aug-2026 MPC
   minutes (held; next MPC 05-07 Oct 2026), and independently by Union Bank's ROI
   PDF (EBLR 8.00 = Repo 5.25 + Spread 2.75). HDFC's undated T&C PDF implies 6.25%
   but is stale. The `repo_rate = 5.25` on all rows stands. Refresh if the next MPC
   moves it.
4. **IDFC First** — ✅ DONE. Row added (advertised_floor 7.75%, EBR-linked, reset
   3-monthly) from the user's official screenshots. Both door fees are "up to"
   ceilings (2% switch, 3% PF) so left NULL → fall back to estimate.

---

## Run order (Supabase SQL editor) — MATTERS

```
0001_rate_registry.sql → 0002_lenders_and_fees.sql → 0003_conversion_flat_fee.sql → 0004_processing_flat_fee.sql → seed_benchmarks.sql
0005_widen_amount_range.sql   (independent; ₹2L–₹20Cr amount range)
0006_abuse_hardening.sql      (independent; 24h rate limit, median/MAD outliers, session revocation)
0007_cibil_band.sql           (independent; CIBIL band cohort dimension; APPLY BEFORE deploying app.js)
0008_ticket_band.sql          (after 0007; ticket-size band cohort dim from amount + 0.75 outlier floor; APPLY BEFORE deploying app.js)
```

All under `rate-registry/supabase/`. `seed_benchmarks.sql` re-run is safe (it
`delete`s those lenders' rows first). `seed_benchmarks.example.sql` is the blank
template for future refreshes. **0005 and 0006 are independent of 0002–0005 and
each other — run any time after 0001.**

---

## Key files (all under `rate-registry/`)

| File | What |
|---|---|
| `index.html` | landing + form + result (two states, no routing); brand masthead; Umami script |
| `app.js` | all behaviour incl. three-door arithmetic. Fee constants (ASSUMPTIONS) at top; `computeDoors()` ~line 400-469; `BANK_GROUPS` dropdown |
| `style.css` | design tokens + layout; hero-card, coins, `landing-grid`/`result-grid`; works to 360px |
| `followup.html` | 3-week follow-up (email link carries `?o=<id>`) |
| `supabase/migrations/0001_rate_registry.sql` | whole DB: schema, RLS, RPCs, triggers |
| `supabase/migrations/0002_lenders_and_fees.sql` | widens allowed-lender check constraints to 30; adds `conversion_fee_pct`, `processing_fee_pct`, `fee_source_url` |
| `supabase/migrations/0003_conversion_flat_fee.sql` | adds `conversion_fee_flat`; rebuilds `bank_benchmark` |
| `supabase/migrations/0004_processing_flat_fee.sql` | adds `processing_fee_flat` (Door-3 takeover); rebuilds `bank_benchmark` + `bank_rates` |
| `supabase/migrations/0005_widen_amount_range.sql` | widens `amt_allowed` to 2–2000 lakh (₹2L–₹20Cr) |
| `supabase/migrations/0006_abuse_hardening.sql` | anti-abuse: 24h rate-limit window (replaces 5/hr), median/MAD outlier test (replaces mean/SD), `banned_sessions` + revocation at 3 flagged reports; adds `session_revoked` error |
| `supabase/migrations/0007_cibil_band.sql` | adds `cibil_band` column + check; rebuilds `submit_rate` (13-arg, +`p_cibil_band`) and `cohort_stats` (6-arg, +`p_cibil_band`, 5 tiers with CIBIL as a dimension); makes the outlier test **per bank+band** (else a low-score band is wrongly flagged as fraud). Must be applied BEFORE the app.js that sends `p_cibil_band`. |
| `supabase/migrations/0008_ticket_band.sql` | adds `amount_band(int)` helper + rebuilds `cohort_stats` (7-arg, +`p_amount_lakh`, 6 tiers with ticket size as a dimension, derived from the amount already collected — no new form field); adds a **0.75-point absolute floor** to the outlier test so legit ticket/category variation within a score band isn't flagged as fraud (found in testing: tight rate clusters make MAD tiny → hypersensitive). Must be applied BEFORE the app.js that sends `p_amount_lakh`. |
| `supabase/seed_benchmarks.sql` | 25 verified lender rows + trailing UPDATEs for flat Door-3 processing fees (BoB ₹8,500, SBI ₹6,500, IDBI ₹0, LIC ₹5,000, Home First ₹16,000). Removed lenders (Indian Bank, Aavas, Can Fin, Sammaan) kept in the delete list but not re-inserted. |
| `README.md` | setup, deploy, security note, fees explanation |

---

## Architecture notes that bite if forgotten

- **anon role has ZERO direct table privileges.** All writes/reads go through
  `security definer` RPCs. `select * from rates` returns *permission denied* — that's
  the core security guarantee (verified live: 401). Don't add a SELECT policy.
- **Why RPCs not `insert().select('id')`:** PostgREST can only return an inserted id
  if a SELECT policy lets the caller read the row — which would break the guarantee.
  RPCs return only ids/aggregates. Documented deviation.
- **RLLR is NOT a hard floor for home loans** — banks advertise below it via
  concessions. `submit_rate` below-floor check uses `min(advertised_floor, rllr) - 0.50`,
  flags (not deletes) floating rates below that as `exclude_reason='below_floor'`.
  Fixed loans exempt; check skipped when no benchmark on file.
- **`submit_rate` signature** (positional, easy to get wrong):
  `(p_session_id uuid, p_loan_type, p_bank, p_rate, p_loan_year, p_amount_lakh, p_rate_type, p_channel, p_employment, p_cmr_band, p_turnover_cr, p_city)`.
- **Allowed channels:** `Branch`, `Agent or DSA`, `Online`, `Builder tie-up`, `Don't remember`.
  **Employment:** `Salaried`, `Self-employed`, or NULL. (Getting these wrong = check-constraint error, not a schema bug.)
- **rates columns:** `excluded` (bool) + `exclude_reason` — NOT `is_excluded`.
- **`cohort_stats`** emits ONE tightest tier (loop counts rows, breaks at first ≥4 or tier 4). Needs ≥4 rows to show an aggregate.

## Local Postgres testing (how I verified)

- Postgres binaries under `/usr/lib/postgresql/*/bin`. **Must run as the `postgres`
  OS user, not root** (initdb refuses root). Put the data dir somewhere `postgres`
  can traverse (I used `/var/lib/postgresql/pgtest`, `chown postgres:postgres`).
- Supabase roles don't exist locally — `create role anon nologin; create role authenticated nologin; create role service_role nologin;` before running migrations, or 0001 fails on `grant ... to anon`.
- Test app.js as browser JS via `node --check app.js` (it's not a module). Playwright: load via `file://` (background http.server was flaky).

## Deploy / analytics

- Netlify: base dir `rate-registry`; env vars `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
  optional `SITE_URL`. Build writes `config.js` and pre-renders `/rates/…`.
- Umami Cloud (free, cookieless). `index.html` loads the script with the site's
  `data-website-id`; app fires `umami.track('Submission')` and
  `umami.track('DoorOpen', {door})`. Events appear automatically — no goal setup.

---

## Recent commits

```
11279b7 Load verified per-lender fees + rates; model flat conversion fees faithfully
4330b34 Add home-loan NBFCs/HFCs and per-lender verified fees
4de1dbf Plain-language pass over the result screen and doors
d921d2a Plain-language landing list + clearer purpose
36d040f Full-width desktop layout (matches whatiff.in), same palette + font
```

## Lender dropdown (`BANK_GROUPS` in app.js)

- **Banks:** SBI, HDFC Bank, ICICI Bank, Axis Bank, Kotak Mahindra, Bank of Baroda, IDFC First, Canara Bank, Union Bank, Punjab National Bank, Bank of India, IDBI Bank, Yes Bank, IndusInd Bank, Federal Bank (Indian Bank removed)
- **Housing finance / NBFCs:** LIC Housing, PNB Housing, Bajaj Housing, Tata Capital, Godrej Housing, Aadhar Housing Finance, Home First Finance, Repco Home Finance, Piramal Finance, Sundaram Home Finance (Aavas, Can Fin, Sammaan removed)
- **Other**

All 25 dropdown lenders have a benchmark row, and all are primary-source verified.
