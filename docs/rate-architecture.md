# WhatIff rate architecture — three benchmarks, never collapsed

**Status:** design spec, pre-implementation. No code changes are implied by this
document; it is the specification to build against.

**Scope:** the rate-registry (`rate-registry/`). This defines how WhatIff reasons
about a borrower's rate: what it observes, what it derives, and what it must never
claim. It supersedes the earlier working assumption that WhatIff should compute a
single "true market rate."

---

## 1. The core principle

WhatIff does **not** compute one true market rate. It keeps three quantities
separate, permanently:

1. **Bank benchmark** — what the lender's pricing mechanism says today
   (Repo / EBLR / RLLR / MCLR / Base / PLR). Sets the *rate environment*.
2. **Peer-observed rate** — what borrowers like this one are *actually* paying.
   Measures *behaviour within* that environment. Deliberately inertia-laden.
3. **Replacement rate** — what this borrower could *potentially* obtain today by
   acting. Measures the *opportunity*, and is per-door, not a single number.

These three diverge, and the divergence is the product. After an RBI cut the
peer curve stays elevated relative to today's achievable pricing, precisely
because borrowers don't continuously renegotiate their spread. We **preserve**
that elevation rather than "correcting" it away — it is the most valuable
behavioural signal in the dataset.

> Phrasing rule: *"The bank benchmark determines the rate environment. Peer rates
> measure actual borrower behaviour within that environment. The replacement rate
> measures the current opportunity available to the borrower."*
> Never: "the benchmark becomes the peer rate."

---

## 2. Layer architecture

| Layer | Calculation | Scope | Nature | MVP? |
|---|---|---|---|---|
| Peer observed rate | `reported_rate` | Cohort | Fact | **Yes** |
| Repo markup | `reported_rate − national_repo` | Repo-linked banks, cross-bank | Derived | **Yes** |
| Benchmark spread | `reported_rate − lender_benchmark` | Within lender | Derived | Fast follow |
| Replacement rate | Counterfactual current pricing | Door 2 / Door 3 | Counterfactual | **Yes** |
| Actionable saving | Stay cost − Act cost | Individual | Derived | **Yes** |

**None of these becomes the "true market rate."** `repo_markup` is context, not a
diagnosis (§8.0). MVP ships on observed rate + `repo_markup` + doors; per-lender
`benchmark_spread` history is a fast follow (§11), not a launch blocker.

Pipeline: **observed rate → repo_markup (context) / benchmark_spread (where held) →
peer distribution → Door 2 counterfactual → Door 3 counterfactual → net actionable
saving.**

---

## 3. The three non-negotiable rules

1. **Never overwrite the observed peer rate with a normalised rate.** The raw
   peer rate is a first-class fact; spread is an *added* lens, never a substitute.
2. **Never present an advertised floor (or any modelled figure) as an
   individual's achievable rate.** Replacement rate is a counterfactual gated on
   eligibility we do not fully observe. Show it as a labelled range or as a
   realised proxy (recent-origination P25), never as a hard personal quote.
3. **Never attribute an automatically-resetting benchmark movement to borrower
   inertia.** For EBLR loans the benchmark component resets on its own; counting
   that as "tax you pay by not acting" is false and overstates savings.
4. **Never display a cohort statistic without its `n` and `as_of` date.** A
   percentile with no sample size and no recency is not publishable.

Rules 2–4 are the difference between a defensible metric and one a careful reader
can break — and careful readers are the whole audience.

---

## 4. Benchmark-family rule (hard data invariant)

**`benchmark_family` classifies the loan; it does not by itself name what we
subtract.** There are two distinct normalized objects, and they must never be
collapsed into one generic "spread":

- **`benchmark_spread` = `reported_rate − lender_benchmark`** — the borrower's
  pricing relative to their *own lender's contractual benchmark* (RLLR for a
  repo-linked bank, PLR for an HFC, MCLR for an MCLR loan). Comparable **within a
  lender**. Needs a dated series for *that lender's* benchmark.
- **`repo_markup` = `reported_rate − national_repo`** — the borrower's *all-in
  markup over the policy rate*. Comparable **across all repo-linked banks**. Needs
  only the one national repo series.

These are economically different. If repo = 5.25, a bank's RLLR = 7.50, and the
borrower pays 8.00: `benchmark_spread` = 0.50 (position vs the lender's benchmark,
i.e. its RLLR reference rate — not its advertised floor, which is a different
object: a published pricing floor, not the reference rate the loan is priced off),
`repo_markup` = 2.75 (which also bundles the bank's structural RLLR markup + credit
premium). Both are legitimate, displayed facts; each is labelled for what it is.

Which object applies, per family:

```
RLLR   → benchmark_spread vs the bank's RLLR series (where published), AND
         repo_markup vs national repo (always available)   [repo-linked]
MCLR   → benchmark_spread vs that bank's MCLR series only   (NOT repo-linked → no repo_markup)
Base   → benchmark_spread vs Base Rate only                 (NOT repo-linked → no repo_markup)
PLR    → benchmark_spread vs the lender's PLR series only    (NOT repo-linked → no repo_markup)
Fixed  → NEITHER (observed layer only)
Unknown→ NEITHER (observed layer only)
```

> **`repo_markup` is repo-linked-only.** Computing `reported_rate − repo` for a
> `PLR`/`MCLR`/`Base`/`Fixed`/`Unknown` loan is a category error — those prices are
> not repo-linked, so the number is not an "all-in markup over policy" in any
> actionable sense. Guard it: `repo_markup` is computed **only** for the `RLLR`
> family.

> **Canonicalization (join-safety).** The resolver emits `RLLR` for bank
> repo-linked loans and never `EBLR`. `benchmark_history` must store both the RLLR
> series and the national repo series under keys the reader expects, or the join
> returns NULL silently. `EBLR` is an alias only, **not** a stored `benchmark_family`.

**Stability caveat (corrected):** a contractual `benchmark_spread` (rate − RLLR) is
*relatively* stable across **repo** resets, because rate and RLLR move together, so
the concession stays roughly constant. `repo_markup` (rate − repo) is **not** stable
in the same way — a bank can revise its own RLLR markup / credit-risk premium even
when the RBI repo doesn't move, which shifts `repo_markup` without any borrower
action. So `benchmark_spread` is the object we may treat as a stable estimate of a
borrower's current pricing; `repo_markup` we may not.

**RLLR history is still required** for `benchmark_spread` on the banks that publish
an RLLR. Reconstructing it as `repo + constant markup` is an approximation that the
stability caveat above says can be wrong wherever the bank revised its markup mid-
window; prefer published historical RLLR effective-dated points, and flag any
reconstructed value.

**Spread guards:** banks advertise *below* RLLR (concessions), so
`advertised_floor` is not a hard floor and a computed spread can be small or
negative. This is legitimate, not an error. Guard the derived-spread and
door-saving math against near-zero / negative spreads the same way the existing
median/MAD outlier test (migration `0006`) guards reported rates — a tiny spread
must never produce an absurd door saving.

---

## 5. Data model

### 5.1 Stored facts (immutable at write time)

```
reported_rate
loan_type
rate_type              -- RLLR / MCLR / Base / PLR / Fixed / Unknown  (EBLR is an
                       --   alias of RLLR, not a separate stored value)
benchmark_family       -- which benchmark this rate is linked to (§4)
benchmark_at_report    -- the applicable benchmark value as of report_date
lender
origination_year
report_date

cibil_band             -- exists (migration 0007)
loan_size_band         -- exists (migration 0008)
borrower_type
city

source_type            -- self_reported / document_verified / partner_verified
```

`benchmark_at_report` is stored because it is a fact *as of* the report date;
storing it lets us reconstruct the report-time spread even if the benchmark series
is later revised. `source_type` is new and matters: it lets the credibility of the
dataset grow over time (self-reported → verified) and feeds the confidence model
(§7).

### 5.2 Derived at read time (never stored on the observation)

```
current_benchmark
current_spread            -- reported_rate − current_benchmark (family-matched)

peer_rate_p25 / _median / _p75
peer_spread_p25 / _median / _p75

door_2_rate / door_2_saving / door_2_net_saving
door_3_rate / door_3_saving / door_3_net_saving
```

**Rule:** no stale derived values on the underlying observation. Everything that
depends on *current* benchmarks or *current* competitor pricing is computed at
read time from live reference data. Baking `replacement_rate`, `rate_gap_*`, or
`monthly_inertia_tax` into the row means every RBI or bank move silently
invalidates stored rows and forces a backfill. Store the inputs; derive the views.
(The existing aggregate RPCs — `bank_rates`, `bank_year_rates` — are already
read-time; this extends that discipline.)

---

## 6. Peer statistics and cohort back-off

### 6.1 Three statistics, not one

- **P25** — "the better-priced quarter of similar borrowers." Identifies the
  actionable gap.
- **Median** — "the typical borrower." Behavioural context.
- **P75** — "the expensive quarter." The user's relative position.

Preferred UI framing:

> Your rate: 9.10% · Similar borrowers: 8.65% median · Better-priced: 8.20%
> — you are paying 0.90% more than the better-priced cohort.

This beats "you are in the most expensive 15%" and, because the distribution is
preserved, it shows the inertia phenomenon without pretending the peer
distribution represents achievable pricing.

Compute both **rate** percentiles (observed, inertia-laden) and **spread**
percentiles (benchmark-normalised, comparable across the rate cycle). Spread
percentiles are computed only within a benchmark family (§4).

### 6.2 Cohort back-off ladder (required)

The current floor is `n ≥ 4` (`bank_rates` / `bank_year_rates`). That is enough to
avoid "a median from 3 rows" but too thin to show a *confident* P25/median/P75 —
and the cohort space (bank × origination_year × cibil_band × loan_size_band)
explodes combinatorially, so most granular cells will be under-populated.

Define an explicit fallback ladder. Try the most specific cohort; if
`n < DISPLAY_THRESHOLD`, drop the least-important dimension and re-aggregate, up a
fixed order, e.g.:

```
bank × year × cibil_band × size_band      (most specific)
bank × year × cibil_band
bank × year
bank
loan_type (all banks)                      (most general)
```

Two thresholds, not one:
- `n ≥ 4` — the existing "may compute a statistic at all" floor. Keep.
- `n ≥ DISPLAY_THRESHOLD` (to be chosen, materially higher than 4) — the "may
  *display* this as a confident percentile" floor that drives the back-off.

**Always surface the level the user is seeing** ("Based on 1,842 comparable
borrowers, same bank and CIBIL band" vs "Based on 61 borrowers at this bank").
`n` and `as_of` are shown with every statistic (rule 4).

---

## 7. The doors are the counterfactual layer

Replacement rate is **not one column** — it splits by door, because the
eligibility hurdle and the cost stack differ fundamentally.

### 7.1 Door 2 — existing lender repricing

Question: *can my existing lender reduce my rate?* The borrower already holds the
loan, so the underwriting hurdle is minimal.

```
current_rate → revised existing-customer rate → conversion fee
```

The revised rate is best expressed as *current benchmark + the lender's current
card spread for this profile*. Note this is a **change from today's code**, where
Door 2 targets cohort P25 (`computeDoors`, `door2.target = cohortP25`) — a
peer-derived proxy. The benchmark-derived target is more defensible; cohort P25
becomes a cross-check, not the target.

Fields: `door_2_rate`, `door_2_basis`, `door_2_confidence`.

### 7.2 Door 3 — balance transfer

Question: *could I transfer this loan?* Full re-underwriting applies.

```
current_rate → competing lender rate → processing fee
             + legal/valuation/MOD/switching costs + eligibility
```

Fields: `door_3_rate`, `door_3_basis`, `door_3_confidence`. Supporting figures
`advertised_floor` and `recent_origination_p25` answer different questions and are
both worth carrying: the advertised floor is best-case marketing; recent-
origination P25 is *realised* data and is the more honest achievability proxy
because it sidesteps the eligibility unknowns.

---

## 8. Metrics and their honesty limits

### 8.0 `repo_markup` is descriptive, not diagnostic

`repo_markup` normalizes and gives analytical context; it is **not** a measure of
how much the borrower is overpaying. The product must never say *"your bank charges
275 bps over RBI repo, therefore you're overpaying by 275 bps"* — that markup
includes the bank's structural cost and credit premium, not just avoidable cost.
The diagnostic question stays: *what are borrowers like you paying, and what would
it cost you to act?* Overpayment is established by the peer distribution and the
door economics, never by `repo_markup` alone.

### 8.0.1 Canonical user-facing sequence (locked)

Every result presents the layers in this order and role, so `repo_markup` stays
context and the action stays the point:

```
You pay:                8.35%
Similar borrowers:      7.85%–8.10%          (peer observed — the behavioural signal)
Pricing context:        +X bps vs your lender's benchmark / +Y bps vs RBI repo   (context only)
If you act:             est. new rate  X%     (Door 2 / Door 3 counterfactual)
Potential saving:       ₹X/month · ₹X over remaining tenure
Cost to act:            ₹X
Net benefit:            ₹X                     (the decision)
```

### 8.1 Master metric: cost of staying vs cost of acting

Make the fundamental output **net benefit of action**, not "inertia tax":

- **Stay** — current loan cost.
- **Door 2** — existing-lender repricing + conversion cost.
- **Door 3** — replacement lender + transfer costs.
- **Net benefit of action** — what the user actually cares about.

Inertia becomes the *explanation* for why the gap exists, not the definition of
the gap. That is much harder to attack.

### 8.2 Inertia cost (narrow, defensible definition)

Do **not** call the whole rate differential an inertia tax — it bundles three
different gaps and only one is inertia:

- **Reset lag** — the EBLR benchmark part that will fall on its own at the next
  reset. Timing, not inertia. Self-heals. *Excluded* from inertia cost.
- **Spread stickiness** — old wide spread vs today's card spread. The real
  inertia component; only closes if the borrower acts.
- **Eligibility gap** — whether they'd actually qualify for the achievable rate
  today (LTV, FOIR, CIBIL, property age may have moved either way).

Define **inertia cost** as the spread-excess portion *net of the cost of fixing
it*:

```
Current rate                 9.10%
Current benchmark            6.60%
Current spread               2.50%
Current bank spread today    1.75%
Spread excess                0.75%
Conversion cost              ₹X
Net benefit from conversion  ₹Y   ← this is the defensible number
```

### 8.3 Pass-through (internal only, until there is a panel)

`Δ peer_rate / Δ bank_benchmark` is conceptually valuable but statistically
fragile at current data scale:

- It needs a **stable panel** (ideally the same borrowers before/after a cut).
  WhatIff has cross-sectional self-reports, and the reporting population *shifts*
  around a cut.
- The aggregate mixes near-100% pass-through (EBLR, auto-reset) with near-0%
  (MCLR/Base/Fixed), so a headline "60–80% pass-through" can be **product-mix**,
  not behaviour. To read the behavioural signal cleanly, condition on EBLR loans,
  where the only sticky thing is spread.

Keep pass-through as an internal directional read. Do **not** headline a
pass-through number until there are repeat-reporters (a panel) or much larger
cohorts.

---

## 9. Confidence is computed, not decorative

`door_*_confidence` (and any displayed confidence) must be a function of concrete,
already-available inputs — not a hand-set label:

- **Fee provenance** — official vs third-party estimate vs generic assumption.
  Already tracked in code as `feeVerified` / `procVerified` (`computeDoors`) and
  in the benchmark seed's third-party-fee policy. Reuse it.
- **Cohort `n`** — behind the peer/replacement figure (drives §6.2 back-off).
- **Benchmark freshness** — the `as_of` date on the `benchmarks` row.
- **Eligibility unknowns** — how many Door-3 eligibility inputs are missing.
- **`source_type`** — self_reported < document_verified < partner_verified.

---

## 10. Selection bias: disclose, don't de-bias

A surge of registrations after an RBI cut is not representative of the loan book —
it skews toward people who noticed the cut, suspect they overpay, are financially
engaged, or hold unusually high rates. Filtering raw → eligible cohorts does
**not** correct this; there is no denominator (the true loan book) to correct
against. Consequences, as rules:

- Keep all claims **individual-level** ("here is where *you* sit vs reporters like
  you"). Do **not** make population claims ("Indians overpay by ₹X") from a
  self-selected panel.
- Timestamp cohorts; be able to show "distribution as of month X."
- Always disclose `n` and recency (rule 4).

The longitudinal ambition — a map of how Indian borrowers respond, or fail to
respond, to changes in the price of credit — is real, but it must be built on
disclosed, caveated, individual-level foundations, not early aggregate claims.

---

## 11. The real cost: a dated benchmark series

The schema changes in §5 are cheap. The genuine, ongoing cost is the **dated
benchmark time series per lender per family**:

- **Repo** — national, trivial, one series.
- **RLLR / MCLR per lender per month** — a recurring data-collection burden.

`benchmark_at_report`, spread history, and pass-through all depend on this
pipeline existing and being maintained, not on a migration. Today `benchmarks` is
a thin current-ish reference (per bank, `effective_from` / `as_of`, verified from
primary sources). Scope the benchmark-capture pipeline as its own workstream; do
not let §8.3 or spread-history be scoped as "just add columns."

---

## 12. What this buys us

Not a rate-comparison engine, but a **longitudinal map of how Indian borrowers
actually respond — or fail to respond — to changes in the price of credit**, with
every displayed number traceable to a fact, a labelled counterfactual, or a
disclosed cohort. Defensible to a journalist, a regulator, a lender, or a
sophisticated borrower.

---

## 13. Suggested build order

1. Add stored-fact columns (§5.1): `rate_type`, `benchmark_family`,
   `benchmark_at_report`, `source_type`. Backfill family/type where inferable.
2. Read-time `current_spread` + spread percentiles, family-matched (§4, §6.1),
   with negative/near-zero guards.
3. Cohort back-off ladder + `DISPLAY_THRESHOLD`; surface level + `n` + `as_of`
   everywhere (§6.2, rule 4).
4. Split replacement into Door 2 / Door 3 with `basis` + computed `confidence`
   (§7, §9). Move Door 2 target from cohort P25 to benchmark + current card spread.
5. Reframe the headline as stay-vs-act / net benefit; define inertia cost
   narrowly (§8.1–8.2).
6. Benchmark-capture pipeline (§11) — prerequisite for pass-through/history.
7. Pass-through only after a panel exists (§8.3).

---

## Open questions

- **`DISPLAY_THRESHOLD` value** and the exact back-off ladder order.
- **Benchmark-capture cadence and source** per lender for RLLR/MCLR.
- **How `rate_type` / `benchmark_family` are captured** — asked of the user, or
  inferred from lender + origination_year? Inference is lossy near the
  MCLR→EBLR transition (2019).
- **Panel construction** — can a returning session be linked to a prior report
  without auth, to enable pass-through? (Interacts with the `0006` session model.)
