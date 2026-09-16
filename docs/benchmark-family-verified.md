# WhatIff benchmark-family — verified lender mapping (batch 1)

**Status:** verification output for `docs/benchmark-family-mapping.md`. Institution
type, benchmark regime, and current benchmark for every live lender, taken from
the in-repo primary-sourced reference `rate-registry/supabase/seed_benchmarks.sql`
(28-lender, seven-batch web-search pass verified **2026-09-10**; still current —
next RBI MPC is 05-07 Oct 2026). Where the seed already cites each lender's own
official page, that is the primary source; this doc classifies, it does not
re-scrape.

## Two corrections to the mapping doc

1. **The live lender set is 25, not 14.** The mapping doc's list came from the
   stale `bm_bank_allowed` CHECK in migration `0001`. The app actually supports the
   25 lenders seeded in `seed_benchmarks.sql` (the 4 removed lenders — Indian Bank,
   Aavas, Can Fin, Sammaan — are dropped and excluded). All 25 are mapped below.
2. **The benchmark fork is settled by the data toward repo-as-benchmark.** Only 8
   of the 15 banks publish a usable numeric repo-linked benchmark (RLLR/EBLR); the
   rest publish only "repo + spread". Keying the RLLR family off the **national
   repo series** (spread = all-in markup over repo) gives every repo-linked bank a
   working, cross-comparable spread from one series. Recommended; pending sign-off.

## Legend

- **Type:** Bank (repo-linked mandate from 01-Oct-2019) | HFC/NBFC (PLR-linked,
  mandate does not apply).
- **Family (post-2019 floating):** the `benchmark_family` the resolver assigns for
  a current-vintage floating loan.
- **Numeric benchmark on file:** the lender's own published benchmark figure, if
  any, from the seed (`as_of` 2026-09-10). "repo + spread" = repo-linked but no
  consolidated RLLR number published.
- **Series feasible?** whether a spread can actually be computed today: **repo** =
  yes via the national repo series (banks); **PLR pt** = only a single current PLR
  point exists (no back-series); **none** = no numeric benchmark → `Unknown` in
  practice.

## Banks (repo-linked; post-2019 floating → `RLLR`, keyed to national repo)

| Lender | Type | Numeric benchmark on file | Advertised floor | Series feasible? |
|---|---|---|---|---|
| SBI | Bank | RLLR 7.50 (repo+CRP) | 7.25 | repo |
| HDFC Bank | Bank¹ | repo + 2.45–3.30 | 7.75 | repo |
| ICICI Bank | Bank | I-EBLR 8.95 | 7.55 | repo |
| Axis Bank | Bank | repo + 2.75 | 8.00 | repo |
| Kotak Mahindra | Bank | repo + spread (no number) | 7.60 | repo |
| Bank of Baroda | Bank | BRLLR 7.90 | 7.25 | repo |
| Canara Bank | Bank | RLLR 8.00 | 7.15 | repo |
| Union Bank | Bank | EBLR 8.00 (repo+2.75) | 7.15 | repo |
| Punjab National Bank | Bank | RLLR 7.75 | 7.20 | repo |
| Bank of India | Bank | RBLR 8.10 (branded RLLR) | 7.10 | repo |
| IDBI Bank | Bank | RLLR 8.15 | 7.40 | repo |
| Yes Bank | Bank | repo + spread (no number) | 8.65 | repo |
| IndusInd Bank | Bank | repo + spread (no number) | 7.60 | repo |
| Federal Bank | Bank | repo + spread (no number) | 7.65 | repo |
| IDFC First | Bank | EBR-linked (no number) | 7.75 | repo |

¹ **HDFC merger special case** (mapping doc §6.1): a pre-2023 "HDFC" home loan was
originated by HDFC Ltd (HFC, RPLR) → `PLR`; 2023 straddles the 01-Jul-2023 merger
→ `Unknown`; ≥2024 is HDFC Bank (repo-linked) → `RLLR`. The "repo + spread" figure
above is the post-merger bank product.

## HFCs / NBFCs (PLR-linked, any vintage → `PLR`; never repo-linked)

| Lender | Type | PLR/benchmark on file | Advertised floor | Series feasible? |
|---|---|---|---|---|
| LIC Housing | HFC | LHPLR (no number in seed) | 7.15 | none → Unknown |
| PNB Housing | HFC | PNBRRR (no number) | 8.50 | none → Unknown |
| Bajaj Housing | HFC | floating ref rate (no number) | 7.30 | none → Unknown |
| Tata Capital | NBFC | RPLR / NRPLR² (no number) | 8.00 | none → Unknown |
| Godrej Housing | HFC | GHF PLR (no number) | 7.65 | none → Unknown |
| Aadhar Housing Finance | HFC | RPLR 17.65 → 17.50 (10-Feb-26) | 11.75 | PLR pt |
| Home First Finance | HFC | HFFC PLR 17.00 (01-Jan-26) | 8.00 | PLR pt |
| Repco Home Finance | HFC | MLR 9.90 (01-Feb-26) | 9.90 | PLR pt |
| Piramal Finance | NBFC | RPLR 20.92 / RFRR 16.65 | 9.99 | PLR pt |
| Sundaram Home Finance | HFC | SH-PLR 17.60 | 10.65 | PLR pt |

² Tata NRPLR applies to loans onboarded w.e.f. 12-Apr-2024; RPLR before. Both are
PLR-family; neither publishes a numeric series.

## What this means for the MVP spread layer

- **All 15 banks** get a working spread now via the **national repo series**
  (`rate-registry/supabase/seed_benchmark_history.sql`, batch 1) — no per-bank RLLR
  needed under the recommended model.
- **HFCs with no numeric benchmark** (LIC Housing, PNB Housing, Bajaj, Tata,
  Godrej) → `Unknown` → peer-observed layer only, no spread. Exactly the "HFC
  without a series → Unknown" outcome the mapping doc specified.
- **HFCs with a current PLR point** (Aadhar, Home First, Repco, Piramal, Sundaram)
  can compute a *current-only* spread (single point, no back-series) — low
  confidence for any non-current report; treat as `Unknown` for older reports until
  a PLR series is collected.

## Verification status per lender

Institution type + regime for all 25 is **verified** (from each lender's own page
via the seed). What remains lender-level:
- confirm the HDFC Ltd→Bank pre/post-2023 split against HDFC disclosures before
  relying on the special-case cell;
- collect PLR **series** (not just current points) for the HFCs, if/when HFC spread
  is in scope (currently deferred — most resolve to `Unknown`).

`family_map_version` for this mapping: **2026.09**.
