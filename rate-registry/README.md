# WhatIff — Home Loan Registry

An anonymous home-loan rate registry. Borrowers report what they actually got;
everyone else sees **what's achievable at their bank — not just the advertised
floor** — and which of three doors is worth taking. No login, no signup, no auth.

The honest claim, narrow on purpose: *a lower rate exists at your bank; your
situation may differ; it's worth ten minutes to find out.* Nothing here says any
borrower was treated unfairly.

- **Stack:** vanilla HTML/CSS/JS, no framework. A small Node build step only
  pre-renders the crawlable aggregate pages and writes `config.js`.
- **Data:** Supabase (Postgres) via the CDN JS client.
- **Hosting:** Netlify, from GitHub, at the root domain.
- **Analytics:** Umami Cloud (free) — visitors → submissions, and of those shown a gap,
  how many open a door.

```
rate-registry/
  index.html            landing + form + result (two states, no routing)
  followup.html         three-week follow-up (email link carries ?o=<id>)
  style.css             design tokens + layout (works to 360px)
  app.js                all behaviour, incl. the three-door arithmetic
  config.example.js     copy to config.js with your Supabase values
  .env.example          the build-time env vars, documented
  netlify.toml          publish + build (writes config.js, renders /rates/)
  package.json          build scripts (only dep: @supabase/supabase-js)
  scripts/
    write-config.mjs    config.js from env vars at build time
    build-aggregates.mjs static /rates/<bank>/ and /rates/<bank>/<year>/ pages
  supabase/migrations/0001_rate_registry.sql   the whole database
```

Only **home loans** are wired in the UI. The schema also carries Business and
Personal so the table never needs migrating when Business ships — those forms
are deliberately not built yet.

---

## 1. Database (Supabase)

1. Create a free project at [supabase.com](https://supabase.com).
2. **SQL Editor** → paste the entire `supabase/migrations/0001_rate_registry.sql`
   and run it. (Or `supabase db push` with the CLI.)
3. Then run `supabase/migrations/0002_lenders_and_fees.sql` — it widens the
   allowed-lender list to include home-loan NBFCs/HFCs and adds per-lender fee
   fields (see "Fees" below). Safe to run once, after 0001.
4. Then run `supabase/migrations/0003_conversion_flat_fee.sql` — it adds a
   `conversion_fee_flat` (rupee) column so lenders that charge a small **flat**
   conversion fee aren't modelled as a % of the loan (see "Fees" below). Run
   after 0002.
5. Then run `supabase/migrations/0004_processing_flat_fee.sql` — same idea for
   Door 3: adds `processing_fee_flat` (rupee) for lenders that charge a flat
   **takeover** fee (e.g. Bank of Baroda ₹8,500). Run after 0003.
6. Optionally run `supabase/seed_benchmarks.sql` to load the verified benchmark
   rates and fees. **Run order matters: 0001 → 0002 → 0003 → 0004 → seed.**

That creates both tables (`rates`, `outcomes`), enables RLS with **no direct
table access for the browser at all**, and creates the write RPCs
(`submit_rate`, `record_outcome`, `record_followup`) and read RPCs
(`bank_rates`, `bank_year_rates`, `cohort_stats`, `business_cohort_stats`,
`total_count`), plus the rate-limit and outlier triggers.

Credentials from **Project Settings → API**: **Project URL** → `SUPABASE_URL`,
**anon / public** key → `SUPABASE_ANON_KEY`. The anon key is meant to live in
the browser; RLS, not secrecy, protects the data.

---

## 2. Run locally

```bash
cd rate-registry
cp config.example.js config.js       # edit with your URL + anon key
python3 -m http.server 8000          # or: npx serve .
# open http://localhost:8000
```

To also generate the static `/rates/` pages locally:

```bash
npm install
SUPABASE_URL=... SUPABASE_ANON_KEY=... npm run gen:aggregates
```

---

## 3. Deploy on Netlify (from GitHub, root domain)

1. Push to GitHub; in Netlify **Add new site → Import an existing project**.
2. Set **Base directory** to `rate-registry`.
3. Add **Environment variables**: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and
   optionally `SITE_URL` (your production origin, for canonical URLs).
4. Deploy. `netlify.toml` runs `npm install && npm run build`, which writes
   `config.js` from the env vars and pre-renders `/rates/…`. The build is
   resilient — with an empty registry it still produces a valid site.

### Analytics

Wired to **Umami Cloud** (free tier). `index.html` loads the Umami script with
the site's `data-website-id`; the app fires **Submission** and **DoorOpen** via
`umami.track()`. Both appear automatically under the website's Events in the
Umami dashboard — no goal setup needed — giving you visitors → submissions →
doors from day one. To point at a different Umami site, swap the
`data-website-id` in `index.html`.

---

## 4. The three doors (assumptions to verify)

The net-benefit maths uses fee constants marked as **ASSUMPTIONS** at the top of
`app.js` (`CONVERSION_FEE_PCT`, `BT_PROCESSING_PCT`, `BT_LEGAL_TECH`,
`BT_MOD_PCT`, `MIN_NET_BENEFIT`). Conversion, processing and MOD charges vary by
lender and state. **Verify a handful against actual lender schedules before
posting the site anywhere** — a wrong net-benefit figure is worse than no
figure. Every door shows its costs, never a gross saving alone.

Outstanding balance is approximated by amortising the original amount at the
user's rate over a standard 20-year schedule (stated in the code) — real tenure
and prepayments aren't captured.

---

## 5. Reference benchmarks (verification) — where the numbers come from

Crowd submissions are one data stream; the **benchmark rates used to verify them
and to show the "advertised floor" are a different stream and must be sourced,
not guessed.** The `benchmarks` table holds them, and it ships **empty** — no
figure ships baked in, because an unverified rate in a financial product is worse
than none.

Every row is auditable: `source_url` and `as_of` are **required** columns, so no
unsourced number can enter. Populate it only from **primary sources**:

- **Repo rate** → RBI (rbi.org.in, MPC / policy rates).
- **RLLR** (a bank's floating floor) → that bank's own interest-rates / RLLR
  disclosure page. Regulatorily published.
- **Advertised floor** (the "from X%") → the bank's home-loan product page.
- **MCLR** (optional, pre-2019 loans) → the bank's MCLR disclosure.

A first pass (fetched 2026-09-07, each figure linked to the institution's own
page) is in `supabase/seed_benchmarks.sql` — **spot-check each source_url, then
run it after the migration**. `supabase/seed_benchmarks.example.sql` is the blank
template for future refreshes. Two figures are flagged in the seed's header to
re-verify (ICICI's RLLR; Tata's blank source is a blog, not a rate card).

What the benchmarks do once populated:

1. **Verification.** For home loans, banks routinely advertise *below* their RLLR
   (concessions), so RLLR is not a hard floor. `submit_rate` uses the lowest rate
   the bank actually publishes — `min(advertised_floor, rllr)` — with a generous
   0.50 margin, and flags any floating submission below that (`exclude_reason =
   'below_floor'`) as a likely data-entry error. Kept, dropped from aggregates.
   Fixed loans are exempt (they don't reset), and the check is skipped entirely
   when no benchmark is on file, so the site works before the table is filled.
2. **The honest "advertised vs achievable" line.** When a verified row exists, the
   result shows the bank's advertised floor next to the achievable rate, **with the
   source link and the date it was true** — the hero claim becomes attributable,
   never asserted by us.

Because floating loans reset to the *current* benchmark, keep the latest row per
bank accurate; refresh whenever the RBI repo rate moves.

### Fees (per lender)

The three-door net-benefit maths needs two fees per lender, held on `benchmarks`
(migration 0002):

- **`conversion_fee_pct`** — what a lender charges to convert/reset the rate on an
  *existing* loan. Drives **Door 2** (uses the user's own bank's figure).
- **`processing_fee_pct`** — a lender's home-loan processing fee for a *new* /
  balance-transfer loan. Drives **Door 3** (uses the cheapest target bank's figure).

Both are fractions of the loan (e.g. `0.005` = 0.5%). Many lenders, though,
charge the conversion fee as a small **flat** rupee amount (or a % with a low
cap that behaves like one); storing those as a % overstates Door 2 badly
(a ₹5,000 fee shown as ₹20,000). So migration 0003 adds
**`conversion_fee_flat`** (rupees) and the app prefers it: Door 2 uses
`conversion_fee_flat` if set, else `conversion_fee_pct` × outstanding, else the
`ASSUMPTION` default. "Up to X%" **ceilings** are never stored as typical fees —
they're left NULL so the door falls back to a labelled estimate rather than
killing every recommendation. **Door 3 is a balance transfer**, so where a lender
charges a flat **takeover** fee (e.g. Bank of Baroda ₹8,500), migration 0004's
**`processing_fee_flat`** (rupees) holds it and Door 3 prefers it: flat →
`processing_fee_pct` × outstanding → the `ASSUMPTION` default (MOD and
legal/valuation are added on top either way). When a lender's fee is
**NULL**, the app falls back to the labelled `ASSUMPTION` constants in `app.js`
and the door says the fee is an *estimate*; when a verified fee is present, the
door says it's the lender's *published figure*. So the site works before you fill
these in, and gets more accurate as you do. Gather them the same way as rates —
from each lender's own fee schedule / MITC — via the fetch prompt; MOD (stamp)
and legal/valuation stay as constants (state-based / roughly fixed).

## 6. Before launch

The site launches empty and stays honest when thin: under 10 rows it hides the
bank list; no aggregate is shown from fewer than 4 reports; cohorts widen and
say so. There is no seed/demo data in the repo by design. Before sharing it
anywhere, seed 40–50 **real** rates from your own network.

---

## Security note — the anon role cannot read raw rows from either table

The property to verify yourself.

- RLS is **enabled** on both `rates` and `outcomes`.
- The `anon` role has **no direct table privilege at all** — no SELECT, INSERT,
  UPDATE or DELETE, and no policy. Every raw-row operation is denied.
- **Writes** go through `security definer` RPCs that return only an id
  (`submit_rate` → new rate id; `record_outcome` → outcome id). No raw row is
  ever returned to the client.
- **Reads** go through `security definer` RPCs that return only aggregates (or,
  for the dot plot, the bare array of rate values in a cohort — never
  `session_id`, `created_at`, `email`, or anything that ties a rate to a person).

Why RPCs and not a direct `insert().select('id')`: PostgREST can only return an
inserted row's id if a SELECT policy lets the caller read that row — which would
make raw rows readable and break the whole guarantee. The RPC returns the id
alone. This also lets correction-exclusion (superseding an edited resubmit)
happen server-side, so `rates` needs no client UPDATE grant.

Verify on the live site — browser console:

```js
const c = window.supabase.createClient(WHATIFF_CONFIG.SUPABASE_URL, WHATIFF_CONFIG.SUPABASE_ANON_KEY);
await c.from('rates').select('*');      // -> error: permission denied for table rates
await c.from('outcomes').select('*');   // -> error: permission denied for table outcomes
```

Both must error. The RPCs still work:

```js
await c.rpc('total_count');                                  // -> a number
await c.rpc('bank_rates', { p_loan_type: 'Home' });          // -> [{ bank, p25_rate, median_rate, n }, ...]
```

If either `select('*')` returns rows, RLS is wrong and every submission — and
every email — is public.
