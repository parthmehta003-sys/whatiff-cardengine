# WhatIff benchmark-family resolution — the mapping spec

**Status:** implementation spec, pre-code. Prerequisite for migration `0009`
(companion to `docs/rate-architecture.md` and `docs/rate-migration-spec.md`).
Implementation of `0009`–`0013` should **not** start until this mapping is
explicit — it is the last genuinely ambiguous part of the architecture, and it
must be a deterministic, versioned lookup, not inference at call sites.

> **Accuracy note.** The regime facts below are the defaults to implement against,
> but each lender-level assignment must be spot-checked against that lender's own
> disclosures during build (the repo's primary-source discipline). Where a fact
> can't be confirmed, the cell resolves to `Unknown`, never to a guess.

---

## 1. Core UX principle (locked)

**Never ask the user for information the institution should know.**

- "Which bank is your loan with?" — reasonable.
- "When did you take the loan?" — reasonable.
- "What's your interest rate (or EMI)?" — reasonable.
- "Is your loan EBLR or MCLR?" — **not** reasonable. The user is here *because*
  they don't know this.

Therefore `benchmark_family` is an **internal data-resolution problem**, not a
consumer input. `rate_family_input` is **removed from the MVP frontend.** The
schema still stores `benchmark_family` (essential to the spread calculation); the
frontend just doesn't ask for it.

If resolution isn't confident → `benchmark_family = Unknown` → **no spread
calculation** (observed/peer layers only). Tolerating `Unknown` beats
interrogating the borrower.

---

## 2. Resolution inputs

```
lender               (required)   -- from bm_bank_allowed
origination_year     (required)
rate_type_plain      (optional)   -- 'fixed' | 'floating' | 'not_sure', from a
                                     PLAIN-ENGLISH question only (see §2.1)
reported_rate        (optional)   -- MVP: not used to resolve; §7 future signal
        ↓
benchmark resolution service
        ↓
benchmark_family + resolution_confidence
```

### 2.1 The only rate question we may ask (plain English, optional)

> **Does your interest rate stay the same for the whole loan, or can it change
> over time?**
> ○ Stays the same ○ Can change ○ Not sure

- "Stays the same" → `Fixed` → no spread.
- "Can change" / "Not sure" → resolve family from institution × vintage (§4–§6).

This is answerable without jargon. We never surface EBLR/RLLR/MCLR to the user.

---

## 3. Institution classification (the first axis)

The Oct-2019 external-benchmark (EBLR/RLLR) mandate applied to **banks**, not
HFCs/NBFCs. So classify every `bm_bank_allowed` lender first:

| Lender (bm_bank_allowed) | Type | Floating benchmark regime |
|---|---|---|
| SBI | Bank | RLLR (repo/EBLR) post-2019 |
| ICICI Bank | Bank | RLLR (repo/EBLR) post-2019 |
| Axis Bank | Bank | RLLR (repo/EBLR) post-2019 |
| Kotak Mahindra | Bank | RLLR (repo/EBLR) post-2019 |
| Bank of Baroda | Bank | RLLR (repo/EBLR) post-2019 |
| IDFC First | Bank | RLLR (repo/EBLR) post-2019 |
| Canara Bank | Bank | RLLR (repo/EBLR) post-2019 |
| Union Bank | Bank | RLLR (repo/EBLR) post-2019 |
| **HDFC Bank** | **Special** | HFC/PLR pre-merger, RLLR post-merger — see §6.1 |
| LIC Housing | HFC | PLR / LHPLR (repo mandate does **not** apply) |
| PNB Housing | HFC | PLR / RPLR |
| Bajaj Housing | HFC | PLR / floating reference rate |
| Tata Capital | NBFC | PLR / benchmark reference rate |
| Godrej Housing | HFC | PLR / RPLR |
| Other | Unknown | → `Unknown` (institution not identifiable) |

**Rule:** HFC/NBFC loans of *any* vintage are PLR-family, never repo-linked. Same
origination year → different family for a bank vs an HFC.

**Canonical family name (join-safety):** the resolver emits **`RLLR`** for all
bank repo-linked loans — never `EBLR`. `EBLR` is the RBI regulatory *category*;
`RLLR` is the stored `benchmark_family`, and `benchmark_history` must key the
bank repo-linked series under the same `RLLR` value. A mismatch (history seeded as
`EBLR`, rows resolved as `RLLR`) makes the spread join return NULL silently.

---

## 4. Regulatory timeline (the second axis)

| Regime | In force for new loans | Notes |
|---|---|---|
| BPLR | before 1 Jul 2010 | legacy |
| Base Rate | 1 Jul 2010 – 31 Mar 2016 | legacy |
| MCLR | 1 Apr 2016 – 30 Sep 2019 (banks) | still exists for un-converted loans |
| EBLR / RLLR | 1 Oct 2019 → (banks, floating retail) | repo-linked; RLLR is the bank product name |
| PLR / RPLR | throughout (HFCs/NBFCs) | not affected by the Oct-2019 mandate |

Boundary that matters most: **1 October 2019** for banks, and **1 July 2023** for
HDFC specifically (§6.1).

---

## 5. The deterministic lookup (institution_type × vintage)

### 5.1 Banks (the eight pure banks in §3)

| Origination year | benchmark_family | resolution_confidence |
|---|---|---|
| ≥ 2020 | `RLLR` | high |
| 2019 | `RLLR` if H2, else `Unknown` | medium (Oct-2019 boundary straddles the year) |
| 2016–2018 | `Unknown` | — (originated MCLR, may have converted; §5.3) |
| ≤ 2015 | `Unknown` | — (Base Rate/BPLR; series not maintained) |

### 5.2 HFCs / NBFCs (LIC Housing, PNB Housing, Bajaj Housing, Tata Capital, Godrej Housing)

| Origination year | benchmark_family | resolution_confidence |
|---|---|---|
| any (floating) | `PLR` | high (institution-determined, vintage-independent) |

Requires a per-HFC PLR/RPLR series in `benchmark_history`. Until that series
exists for a given HFC, it degrades to `Unknown` (no spread) — never to a guess.

### 5.3 Why 2016–2018 bank loans are `Unknown`, not `MCLR`

Two independent reasons, both sufficient:
1. **Regime ambiguity** — the loan was MCLR at origination but may have been
   converted to EBLR any time after Oct 2019. `origination_year` records the
   original regime, not the current one, and we don't observe conversions.
2. **Missing series** — MCLR spread needs each bank's MCLR curve; the `benchmarks`
   /`benchmark_history` MCLR data is sparse. No series → no spread anyway.

`MCLR` stays a valid `benchmark_family` value in the schema (for future data and
for doc-parsing that reads "linked to MCLR" off a statement), but the MVP
resolver does not assign it from year alone. These loans keep the peer-observed
layer; they just get no spread.

---

## 6. Special cases

### 6.1 HDFC (the merger landmine)

HDFC Ltd (HFC, RPLR-linked home loans) merged into HDFC Bank on **1 July 2023**.
The `bm_bank_allowed` label is a single "HDFC Bank", but it spans two regimes:

| Origination | Reality | benchmark_family | confidence |
|---|---|---|---|
| ≤ 2022 | HDFC Ltd home loan (HFC) | `PLR` | high |
| 2023 | straddles the 1-Jul-2023 merger | `Unknown` | medium |
| ≥ 2024 | HDFC Bank (bank) | `RLLR` | high |

Rationale: pre-merger retail home loans were originated by HDFC Ltd (HFC, RPLR),
not by HDFC Bank; so a pre-2023 "HDFC" home loan resolves to PLR, not RLLR.

### 6.2 Fixed-rate products

Any lender, `rate_type_plain = 'fixed'` → `Fixed` → no spread. (Also some HFC
"fixed-then-floating" products exist; if the user says it can change, treat as
floating and resolve normally.)

### 6.3 `Other` lender

`Other` → `Unknown` unconditionally (institution type unknown, so neither axis
resolves).

### 6.4 "Not sure" on fixed/floating

Treat as floating for resolution (floating is the overwhelming majority of Indian
home loans), but cap `resolution_confidence` at `medium` and let downstream
confidence reflect it.

---

## 7. `reported_rate` disambiguation — future, NOT MVP

`reported_rate` could disambiguate the `Unknown` bands (e.g. a 2017 bank loan
whose rate ≈ current repo + typical spread was probably converted to EBLR; a high
sticky rate suggests it's still MCLR). This is deferred because:

- it is inference, and the locked principle is "don't guess from year alone" —
  rate-based guessing is only acceptable as an explicit, confidence-scored signal,
  not a silent default;
- it needs the benchmark series (§5.2/§5.3) to exist first.

When built, it computes candidate spreads against each plausible family; if they
agree within a tolerance it may raise confidence, otherwise it stays `Unknown`.
Document/statement parsing ("linked to MCLR") is the cleaner long-term resolver.

---

## 8. `resolution_confidence`

An enum stored/attached at resolution, and an input to the door confidence model
(design §9):

| Value | When |
|---|---|
| `high` | banks ≥2020; HFCs with a live PLR series; HDFC ≤2022 / ≥2024 |
| `medium` | 2019 bank boundary; HDFC 2023; "not sure" floating |
| `unknown` | 2016–2018 & ≤2015 banks; `Other`; HFC without a series; unresolved |

`unknown` ⇒ `benchmark_family = Unknown` ⇒ no spread.

---

## 9. Versioning

The mapping is **versioned** (`family_map_version`, e.g. `2026.09`). Store the
version used on each resolved row so a later mapping revision (new lender, a
corrected regime fact, HFCs brought under an external benchmark) is auditable and
re-runnable. Resolution is a pure function of
`(lender, origination_year, rate_type_plain, family_map_version)`.

---

## 10. Boundary-year test cases (acceptance)

| lender | year | fixed/floating | expected family | expected confidence |
|---|---|---|---|---|
| SBI | 2021 | floating | RLLR | high |
| SBI | 2019 | floating | RLLR or Unknown (H2 rule) | medium |
| SBI | 2017 | floating | Unknown | unknown |
| SBI | 2012 | floating | Unknown | unknown |
| ICICI Bank | 2024 | floating | RLLR | high |
| LIC Housing | 2024 | floating | PLR (if series) / Unknown | high / unknown |
| LIC Housing | 2016 | floating | PLR (if series) / Unknown | high / unknown |
| Bajaj Housing | 2023 | floating | PLR (if series) / Unknown | high / unknown |
| HDFC Bank | 2021 | floating | PLR | high |
| HDFC Bank | 2023 | floating | Unknown | medium |
| HDFC Bank | 2025 | floating | RLLR | high |
| Any | any | fixed | Fixed | (n/a — no spread) |
| Other | 2024 | floating | Unknown | unknown |
| SBI | 2022 | not sure | RLLR | medium (capped) |

---

## 11. What this changes in the migration spec

- **0009:** drop `rate_family_input` from the frontend; `benchmark_family` is
  written by the resolution service from `(lender, origination_year,
  rate_type_plain)`. Add `resolution_confidence` and `family_map_version` to the
  stored facts.
- **0011:** the spread rule is single and explicit — **a report's spread =
  `reported_rate − benchmark effective on that report's `report_date``**, looked up
  in `benchmark_history` by `(lender, benchmark_family, latest effective_from ≤
  report_date)`. The live/current spread is the special case where `report_date`
  is today. This prevents manufacturing false spread changes when the benchmark
  has since moved, and exploits that spread is stable across resets while the
  headline rate is not.
- **Acceptance (all displayed numbers):** every rate the UI shows must carry its
  provenance — one of {peer-observed, advertised floor, Door-2 proxy,
  benchmark-derived} — with the relevant `n`, `as_of`, `cohort_level`, `basis`,
  `source_type`, and `resolution_confidence`. Three examples that must render as
  visibly different epistemic objects: a peer-observed 8.35% (n, as_of, cohort);
  an advertised-floor 7.75% (lender, as_of, basis=advertised_floor); a Door-2
  proxy 7.62% (basis=cohort_spread_p25, n, benchmark). WhatIff never presents one
  blended "true market rate".
