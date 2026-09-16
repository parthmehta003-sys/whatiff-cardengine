# WhatIff rate architecture — migration + RPC spec (Phases 1–3)

**Status:** implementation spec, pre-code. Companion to `docs/rate-architecture.md`
(the locked design). This turns Phases 1–3 of that design's build order into a
concrete migration/RPC plan. No code is written by this document.

**Scope:** database (`rate-registry/supabase/migrations/`, next number `0009`),
the read-path RPCs, and the client points in `rate-registry/app.js` that must
change with them. The benchmark-capture *pipeline* (design §11) runs in parallel
and does **not** block this work.

**Migrations continue the existing numeric sequence:** current head is `0008`, so
new files are `0009`–`0013`. Every base table keeps the repo's RLS pattern
(`revoke all ... from anon, authenticated`); every read RPC is
`security definer`, `set search_path = public`, and `grant execute ... to anon`
(the read path is unauthenticated).

---

## 0. Locked decisions (the four open questions)

| # | Decision | Notes |
|---|---|---|
| 1 | **`DISPLAY_THRESHOLD = 30`** | Product display threshold, *not* an inference threshold. Keep `n ≥ 4` as the compute floor. Tail stats (P25/P75) at n=30 are softer than the median — the confidence model reflects this. |
| 2 | **Benchmark capture: append-only, monthly baseline + event-driven** | Repo on every RBI change; lender RLLR/MCLR monthly, plus immediately after an RBI move or a new rate card. Store every observation; never overwrite. |
| 3 | **`benchmark_family`: resolved server-side, NOT asked** | The user is never asked the benchmark mechanism (EBLR/MCLR is jargon that breaks the product's premise). It is resolved from `(lender, origination_year, rate_type_plain)` per `docs/benchmark-family-mapping.md`. `Unknown` is acceptable → observed/peer layers only, no spread. **The mapping spec must be locked before implementation starts.** |
| 4 | **Panel: deferred** | Keep the existing session model (migration `0006`). No auth introduced to build a research panel. Pass-through stays internal until a privacy-preserving anonymous `reporter_id` is designed. |

### 0.1 Family resolution (server-side, no jargon to the user)

`benchmark_family` is **not** a consumer input. `rate_family_input` is **removed
from the MVP frontend.** The only rate question the user may see is plain-English
fixed/floating:

> **Does your interest rate stay the same for the whole loan, or can it change?**
> ○ Stays the same ○ Can change ○ Not sure

That yields `rate_type_plain`. The family is then resolved server-side from
`(lender, origination_year, rate_type_plain)` — a deterministic, versioned lookup
(institution type × vintage) defined in `docs/benchmark-family-mapping.md`. If it
can't resolve confidently → `Unknown` → no spread. Never guess from year alone.

---

## 1. Migration 0009 — observation facts

### 1.1 What already exists (do not clobber)

`submit_rate` already accepts `p_rate_type` and the `rates` table already stores a
**coarse** `rate_type ∈ {Floating, Fixed}`. That coarse value drives the existing
floating-loan floor sanity-check (`p_rate_type = 'Floating'`). **Keep it.** The
granular family is an *additional* column.

### 1.2 New stored-fact columns on `rates`

```
benchmark_family     text    -- EBLR | RLLR | MCLR | Base | PLR | Fixed | Unknown
benchmark_at_report  numeric(5,2) NULL  -- audit snapshot (§1.3); NOT the live-spread source
source_type          text    -- self_reported | document_verified | partner_verified
benchmark_source     text NULL          -- provenance of benchmark_at_report (RBI | lender_card | lender_statement | user | partner)
resolution_confidence text   -- high | medium | unknown (from the family resolver)
family_map_version   text    -- e.g. '2026.09' (which mapping version resolved this row)
```

- Add a CHECK constraint enumerating `benchmark_family`, `source_type`, and
  `resolution_confidence` values.
- `source_type` defaults to `self_reported`.
- **Resolution step (write time):** `benchmark_family` (+ `resolution_confidence`,
  `family_map_version`) is resolved from `(lender, origination_year,
  rate_type_plain)` per `docs/benchmark-family-mapping.md` — a deterministic,
  versioned lookup on institution type × vintage. No `rate_family_input` is
  captured from the user. Backfill the coarse `rate_type`: family in
  `{EBLR,RLLR,MCLR,Base,PLR}` → `Floating`; `Fixed` → `Fixed`; `Unknown` → leave
  `rate_type` as submitted (default `Floating` unless the user said fixed).
- **Do not** add any derived column (`current_spread`, gaps, savings) to `rates`.
  Those are read-time only (design §5.2).

### 1.3 The `benchmark_at_report` immutability-vs-sparsity decision

`benchmark_at_report` is stored as an **audit snapshot only**, and is **nullable**.
Early on, history (`0010`) will have gaps for a given lender/family/date, so
capturing a value at write time often can't be done. Therefore:

- **Source of truth for live spread is the read-time derivation** (RPC `0011`),
  which joins current history — robust to later backfill.
- `benchmark_at_report` is filled at write when history already covers the date;
  otherwise NULL, and a reconciliation job may fill it **once** later, stamping
  `benchmark_source`. It is never used as the compute input for a displayed spread.

This preserves the design's audit intent without letting sparse early data poison
any number.

---

## 2. Migration 0010 — benchmark history (append-only)

### 2.1 Why additive, not in-place

The existing `benchmarks` table is populated (`seed_benchmarks.sql`) and has two
dependents: `bank_benchmark()` and the `submit_rate` floor check
(`least(advertised_floor, rllr)`). It is **wide** (per bank/date columns
`repo_rate, rllr, mclr, advertised_floor`). The family-keyed series we need is
**long**. Rather than restructure a live depended-on table, add a new table and
redefine the dependents to read from it.

### 2.2 `benchmark_history`

```
id              bigserial pk
lender          text          -- 'SBI', ... ; reuse the bm_bank_allowed value set, or 'National' for repo
benchmark_family text         -- EBLR | RLLR | MCLR | Base | PLR | Repo | AdvertisedFloor
effective_from  date not null -- when this figure took effect
benchmark_rate  numeric(5,2) not null
source_url      text not null
verified_at     date not null
note            text
unique (lender, benchmark_family, effective_from)
```

- **No `effective_to`.** Append-only. The active row for a date is
  `latest effective_from ≤ target_date` within `(lender, family)`. Storing
  `effective_to` would force updating the prior row on each insert — an update
  anomaly that breaks append-only. Derive the interval when needed.
- **Repo** is one national series (`lender = 'National'`, `family = 'Repo'`).
- **`advertised_floor`** is preserved as its own pseudo-family
  (`family = 'AdvertisedFloor'`), so the floor check keeps working.
- RLS: revoke from `anon/authenticated`; expose only through RPCs / a view.

### 2.3 Backfill + redefinition

- Backfill `benchmark_history` from the current `benchmarks` rows (one wide row →
  up to four long rows: repo, rllr, mclr, advertised_floor, skipping NULLs).
- Provide a `current_benchmark` VIEW (latest per lender/family) for convenience.
- **Redefine** `bank_benchmark()` to read latest repo/rllr/advertised_floor from
  history (same return shape — no caller change).
- **Redefine** the `submit_rate` floor check to read
  `least(AdvertisedFloor, RLLR)` from history. Behaviour must be identical for
  existing seed data — assert with a before/after spot check.
- Keep the old `benchmarks` table for now (read by nothing after redefinition);
  schedule its removal in a later migration once history is authoritative.

---

## 3. Migration 0011 — spread RPC

```
get_current_spread(p_report_id bigint) returns numeric
```

**The single spread rule (applies to every report, current or historical):**

> A report's spread = `reported_rate − benchmark effective on that report's
> `report_date``, looked up in `benchmark_history` by
> `(lender, benchmark_family, latest effective_from ≤ report_date)`.

The live/current spread is just the special case where `report_date` is today.
Using the *current* benchmark for an *older* report would manufacture a false
spread change (a 9.1% report from six months ago, after a 100 bps move, would show
a fabricated 100 bps swing). Because spread is stable across resets while the
headline rate is not, the as-of-report-date spread is also a *better* estimate of
that borrower's current spread than their stale headline rate.

Logic (family invariant is hard — design §4):

```
resolve (lender, benchmark_family, report_date) from rates
if benchmark_family in (EBLR, RLLR, MCLR, Base, PLR):
    b := active benchmark_history rate for (lender, family)
         at report_date  (latest effective_from <= report_date)
    if b is null: return null            -- series gap → no spread, never a guess
    spread := reported_rate - b
    -- guard (design §4): a small/negative spread is legitimate (concessions
    -- below RLLR), but clamp only obvious impossibilities; never let a tiny
    -- spread flow into an absurd door saving downstream
    return spread
else:                       -- Fixed | Unknown
    return null             -- observed/peer layers only
```

- **No `reported_rate - repo` shortcut** for non-repo-linked loans.
- Companion aggregate `get_spread_percentiles(cohort…)` computes P25/P50/P75 of
  spread **within a single benchmark family** (never mix families), each member's
  spread taken as-of its own `report_date` per the rule above.

---

## 4. Migration 0012 — cohort RPC with back-off ladder

Replace the single-level cohort lookup with a ladder that returns exactly **one
coherent level** (never a median from one level and P25 from another).

```
Ladder (most specific → most general):
  bank × year × cibil_band × size_band
  bank × year × cibil_band
  bank × year
  bank
  loan_type (all banks)
```

At each level, in order:

```
if n >= DISPLAY_THRESHOLD (30):  return this level's full stat set
else:                            continue to next level
-- retain the n >= 4 compute floor: never emit a statistic from < 4 rows even
-- at the most general level; if even loan_type has < 4, return no-cohort.
```

Return shape (so the frontend can explain the number — non-negotiable #4):

```
metric            -- rate | spread
p25, median, p75
n
as_of             -- max verified/report date in the cohort
cohort_level      -- e.g. 'bank_year_cibil' | 'bank_year' | 'bank' | 'loan_type'
```

Correctness constraints:

- Apply `excluded = false` (the `0006` outlier flag) to every cohort.
- **Exclude the user's own live report** from the cohort it is compared against
  (the supersede rule means one live row per session; don't let the user inflate
  their own peer set at small n).
- Compute both `rate` and `spread` percentile sets; `spread` set is family-scoped
  and omitted for `Unknown`/`Fixed`.

---

## 5. Migration 0013 + `app.js` — the doors

The doors math lives **client-side** in `computeDoors` (`app.js`), fed by RPCs.
So this step is part SQL (expose the inputs) and part JS (change the target).

### 5.1 Door 2 — existing lender repricing

Change the target from cohort P25 to a benchmark-derived rate:

```
door_2_target := current lender benchmark (family-matched)
               + current lender card spread for the profile
```

**Honesty caveat (non-negotiable #2):** we do not hold lenders'
profile-conditioned spread grids. The "card spread" is a *proxy*, and its basis
must be recorded:

```
door_2_basis ∈ {
  advertised_floor,          -- benchmark + (advertised_floor - benchmark)
  cohort_spread_p25,         -- benchmark + cohort spread P25 (peer-derived proxy)
  published_grid             -- only where a real grid exists
}
door_2_confidence := f(basis, cohort n, benchmark as_of, fee provenance)
```

Cohort P25 becomes a **cross-check**, not the target. Saving:

```
door_2_saving = current loan cost - repriced loan cost - conversion cost
```

Reuse the existing conversion-fee provenance flag (`convVerified` in
`computeDoors`) as a confidence input.

### 5.2 Door 3 — balance transfer

```
door_3_target := competing lender current advertised / realised pricing
door_3_basis  ∈ { advertised_floor, recent_origination_p25 }
door_3_confidence := f(basis, eligibility unknowns, cohort n, benchmark as_of, proc-fee provenance)
door_3_saving = current loan cost - new-lender loan cost
              - processing fee - legal/valuation/MOD - switching costs
```

Label Door 3 explicitly as a counterfactual with a different (full)
re-underwriting hurdle than Door 2. `recent_origination_p25` is the more honest
achievability proxy (realised data, sidesteps eligibility unknowns) than the
advertised floor.

### 5.3 Frontend reframe (design §8.1)

Headline becomes **stay-vs-act / net benefit of action**, not "inertia tax."
Inertia is the *explanation*, defined narrowly (design §8.2): spread excess net of
fix cost, **excluding** reset lag and eligibility gap. This is a copy/logic change
in `app.js`, not a migration.

---

## 6. Confidence model (design §9)

`door_*_confidence` is **computed**, never hand-set, from already-available inputs:

- fee provenance (`convVerified` / `procVerified` in `computeDoors`);
- cohort `n` (drives §4 back-off);
- benchmark freshness (`as_of` / `verified_at`);
- Door-3 eligibility unknowns (count of missing inputs);
- `source_type` (self_reported < document_verified < partner_verified);
- **stat type**: tail (P25/P75) at n≈30 scores lower than median at the same n.

---

## 6a. Provenance acceptance criterion (every displayed number)

For **every** rate the UI shows, the system must be able to answer "where did this
number come from?" through metadata, not just internally. Each displayed rate
carries its epistemic type and supporting fields:

- **Peer observed** — `n`, `as_of`, `cohort_level`, `source_type`.
- **Advertised lender floor** — `lender`, `as_of`, `basis = advertised_floor`.
- **Door-2 proxy** — `basis` (advertised_floor | cohort_spread_p25 |
  published_grid), `n`, the `benchmark` used.
- **Benchmark-derived** — `lender`, `benchmark_family`, `as_of`,
  `resolution_confidence`.

These are different epistemic objects and the UI must render them as visibly
different — WhatIff never collapses them into one blended "true market rate"
(design §1). This is a release gate, not a nicety.

## 7. Out of scope here (explicit)

- **Benchmark-capture pipeline** (design §11) — parallel workstream; only its
  *schema* (`0010`) is in scope.
- **Pass-through metric** — internal only until a panel exists (decision #4).
- **Population-level claims** — forbidden (design §10); all output stays
  individual-level.
- **Document/statement parsing** for auto-populating `benchmark_family` /
  `source_type` — later.
- **Dropping the old `benchmarks` table** — deferred to a post-`0013` migration.

---

## 8. Validation checklist (before each migration merges)

- `0009`: family resolution follows `docs/benchmark-family-mapping.md` exactly
  (institution × vintage, HDFC merger case, HFC→PLR, ambiguous→Unknown); no
  `rate_family_input` reaches the backend; `resolution_confidence` +
  `family_map_version` stored; coarse `rate_type` backfill leaves the existing
  floor check behaving identically; CHECK constraints hold; boundary-year test
  cases (mapping spec §10) pass.
- `0010`: `bank_benchmark()` and the `submit_rate` floor check return **identical**
  results on seed data before vs after redefinition (spot-check several banks);
  history is append-only (no UPDATEs in normal capture).
- `0011`: `Unknown`/`Fixed` return NULL spread; spread uses the benchmark
  as-of `report_date` (an older report is not re-based to today's benchmark);
  live report matches `reported_rate − current benchmark`; series gap → NULL, not
  a guess; no `rate − repo` path exists for non-repo families.
- `0012`: back-off returns one coherent level; `n ≥ 4` floor never violated;
  user's own row excluded; `cohort_level`/`n`/`as_of` always populated.
- `0013`/`app.js`: Door 2 target no longer equals cohort P25; `basis` +
  `confidence` populated on both doors; no door saving from a near-zero/negative
  spread; headline reframed to net-benefit.
- **All displayed rates** carry provenance metadata per §6a (release gate).

---

## 9. Open decisions for implementation

- The `(lender, origination_year, rate_type_plain) → benchmark_family` mapping is
  **resolved** — see `docs/benchmark-family-mapping.md` (lock before code). What
  remains is per-lender verification of each regime fact against that lender's own
  disclosures during build.
- Whether to keep both coarse `rate_type` and `benchmark_family` long-term, or
  derive the coarse one as a view once the floor check reads family directly.
- `DISPLAY_THRESHOLD` per-statistic (single 30, or 30 for median / higher for
  tails).
- Cohort back-off: fixed ladder (this spec) vs a "largest level with
  `n ≥ threshold`" search — fixed ladder is simpler and preferred for v1.
