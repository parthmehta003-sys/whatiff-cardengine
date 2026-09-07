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
- **Analytics:** Plausible — visitors → submissions, and of those shown a gap,
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

Replace `REPLACE_WITH_YOUR_DOMAIN` in `index.html`, add the site in Plausible,
and create two goals: **Submission** and **DoorOpen**. That gives you
visitors → submissions and submissions → doors from day one.

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

## 5. Before launch

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
