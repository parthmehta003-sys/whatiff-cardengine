# How WhatIff Works — End-to-End Logic

*A plain-English audit of exactly what happens from the moment someone enters
their rate to the result they see. Written so you can confirm the logic
is sound before trusting it with real users. Every claim below maps to real code
— file references are given so you (or an engineer) can check each one.*

Last updated: 2026-09-24.

---

## 0. The claim we make — and the ones we deliberately don't

WhatIff says one narrow, honest thing:

> *Here is what borrowers like you actually report paying, and here is what each
> option would add up to — you decide.*

It **presents information; it does not advise, recommend, or facilitate.** It does
**not** pick a "best move" for you, tell you to switch, claim anyone was cheated,
say you're "overpaying," or guarantee a saving. Every number is shown with its
source, its sample size, and its costs, and the decision is explicitly left to the
reader. That restraint is a design rule, not an afterthought — it is also what
keeps WhatIff clearly an information service and **not** a DSA, LSP, broker or
adviser. *(`app.js`, result screen)*

---

## 1. What happens when a user submits a rate

The form collects **10 facts**: bank, interest rate, year taken, loan amount, rate
type (floating/fixed), how they got the loan (channel), employment type, CIBIL
band, and the **original loan tenure** (all required), plus the **amount still
owed** (optional). Then:

### 1.1 Sign-in is required (anti-spam identity)
Adding a rate requires a signed-in account (Google or email/password). The
identity is derived **server-side** from the login token inside the `submit_rate`
function (`auth.uid()`), never sent by the browser — so it can't be faked. Reading
the registry needs no login. *(migration `0014_auth_identity.sql`)*

### 1.2 Validation (two layers)
- **In the browser:** rate must be 6–15%, every field must be chosen.
- **In the database:** hard constraints re-check everything — rate 6–15, year
  2015–2026, amount ₹2 lakh–₹20 crore, allowed banks/channels/CIBIL bands. The
  browser can't bypass these; they live on the table itself. *(`0001`, `0005`,
  `0007`)*

### 1.3 The submission pipeline (`submit_rate`)
When the rate reaches the database, in order:
1. **Blocked-account check** — if this account was revoked for repeated bad data,
   it's refused.
2. **Duplicate/correction handling** — if you re-submit an *identical* entry, it
   returns your existing record (no duplicate). If you submit a *changed* entry,
   the new one is kept and your **previous one is superseded** — so one person
   ends up with exactly **one live report per loan**, by construction. This is
   keyed to your account, so clearing your browser doesn't let you stack entries.
3. **Benchmark family resolution** — the system works out whether your loan is
   repo-linked (RLLR), MCLR-era, or an HFC/PLR product, so later comparisons use
   the right reference. *(`0009`, `0013`)*
4. **Below-floor sanity check** — for floating loans, if your rate is more than
   0.50% *below* the lowest rate your bank actually publishes, it's flagged as a
   likely typo and dropped from averages (kept on record, just not counted). Fixed
   loans are exempt. *(`0013`, via `bank_floor()`)*
5. **Insert** the row, bound to your account.

### 1.4 Two automatic quality gates fire on every insert
- **Rate limit:** at most 8 submissions per account per 24 hours (a flood guard;
  normal corrections never hit it). *(`0006`/`0014`)*
- **Outlier detection:** see §4.

### 1.5 Revocation
If one account accumulates **3+ flagged (out-of-range) reports**, it's
automatically blocked from submitting more. *(`0014`, `banned_users`)*

---

## 2. How you're compared to peers — the cohort engine

This is the heart of it. We never compare you to "everyone." We compare you to
**people like you**, and we're honest about how tight that match is.

### 2.1 The matching ladder
`cohort_stats` looks for the **tightest group that has at least 4 reports**,
starting narrow and widening only as needed:

| Tier | Matches on | Example label |
|---|---|---|
| 1 | bank + CIBIL band + loan size + employment + year + channel | "your exact group" |
| 2 | drop channel | "…who took a loan in 2024 (any channel)" |
| 3 | drop year | "SBI salaried borrowers in the 800+ band borrowing ₹30–75 lakh" |
| 4 | drop employment | "SBI borrowers in the 800+ band borrowing ₹30–75 lakh" |
| 5 | drop loan size | "SBI borrowers in the 800+ CIBIL band" |
| 6 | bank only | "all SBI borrowers" |

The two dimensions that most drive an Indian home-loan rate — **credit score and
loan size** — are dropped *last*, so they survive as long as the data allows.
*(`0007`, `0008`, `0012`)*

### 2.2 Why these dimensions (and not city)
For floating home loans the rate is largely national (repo + a spread); the spread
is set mostly by **credit score**, **loan size**, and **employment type** — not
geography. City was deliberately rejected: it barely moves the rate, it makes the
groups too sparse to ever fill, and being unverifiable it's a spam target.

### 2.3 The "≥4 reports" rule (the trust floor)
**No aggregate is ever shown from fewer than 4 reports.** If even the widest tier
(all of your bank's borrowers) has fewer than 4, you see *"we don't have enough
reports yet"* — not a made-up number. A single bad row can therefore never move a
published figure on its own. *(`0001`, `cohort_stats`)*

### 2.4 What the numbers mean
For the chosen group we compute:
- **P25** — the rate at the *better-priced quarter* of similar borrowers. This is
  the "achievable" number. We use a realised P25, **not** the bank's advertised
  "from X%" floor (which is best-case marketing).
- **Median** and **P75** — so we can show a *range* others actually report, not a
  single cherry-picked best case.

---

## 3. What the result screen tells the user

The screen states the facts first, then the evidence. It **presents the applicable
options and their numbers — it does not recommend one** (see §5).

1. **Headline (a neutral statement of where you stand).** Decided by whether a
   lower rate exists among peers and whether any option nets a positive benefit:
   - *"A lower rate is on record for people like you."* (an option nets a positive
     benefit)
   - *"Your rate is competitive — though a lower one is on record."*
   - *"A lower rate is on record — but likely not worth a move today."* / *"Your
     rate holds up well against people like you."* (no option nets a positive
     benefit)
   The sub-line states what the best option could be worth and adds *"you decide"* —
   never *"you should."*
2. **You pay vs similar borrowers.** Your rate + EMI, next to the P25–P75 **range**
   for your cohort, and the ₹/month difference "on what you still owe."
3. **"N out of 10 people at your bank report a lower rate than yours."** A plain
   read of where you sit — with the caveat that rates legitimately differ by
   profile.
4. **Pricing context (only for repo-linked loans).** "Your rate is X points above
   the RBI repo rate of 5.25%." Shown only where it's meaningful (RLLR loans),
   and **nothing** is shown for HFC/PLR products where a repo comparison would be
   misleading. *(`0011`, `get_repo_markup`)*
5. **Advertised-floor line.** If we have a verified, dated, sourced benchmark for
   the bank, we show the advertised floor next to the achievable rate — with the
   source link. No unsourced number is ever shown.
6. **The dot plot.** Every rate in your cohort, with yours marked — so the
   comparison is transparent, not a black box.

---

## 4. Outlier / bad-data detection (why the averages stay clean)

A rate is dropped from the averages only when it is **both**:
- statistically far from its peers — more than `3.5 × 1.4826 × MAD` from the
  **median of its own bank + CIBIL band**, *and*
- at least **0.75 percentage points** off that median.

Two deliberate design choices here:
- We use the **median and MAD** (median absolute deviation), not the mean and
  standard deviation, because the mean/SD are themselves corrupted by the fake
  data we're trying to catch — the median isn't.
- We segment by **CIBIL band**, because a lower-score borrower legitimately pays
  more; judging them against the whole bank would wrongly flag a real group as
  fraud. And the **0.75-point floor** stops ordinary variation (loan size,
  employer, negotiation) from being mistaken for an error. A genuine typo like
  13.5% is still caught. *(`0007`, `0008`)*

Nothing is deleted — flagged rows are kept on record, just excluded from what's
shown.

---

## 5. The "doors" — the money math

We model the options and **show every one that actually saves money after its
costs, side by side, with no single one recommended** — the reader compares and
decides. An option whose costs would outweigh its saving is not shown as an option
at all (so you never see a "benefit" that is really a loss).

### 5.1 The balance and remaining term
Two facts drive the money math, and we now **ask** for them so it isn't a guess:
- **Loan tenure** (required) → remaining years = `tenure − years since taken`, so
  "how much is left" is real, not a fixed 20-year assumption. A loan at the end of
  its term shows "little left to save" rather than a fictional figure.
- **Amount still owed** (optional) → if you enter it, we use your **actual**
  outstanding. If you leave it blank, we estimate it by amortising the original
  loan over your real tenure **assuming no prepayment**, and the result says so.
All three doors compute interest on this balance over the remaining years.

### 5.2 The doors
- **Reprice at your current bank** (a conversion/switch fee). Comparison rate =
  your cohort's P25 — what the better-priced quarter of **similar borrowers at your
  bank** report (a peer figure, profile-scoped, not an advertised rate). Cost = the
  lender's conversion fee (a flat ₹ figure for many banks, else a %, else a
  labelled estimate).
- **Transfer to another lender.** Comparison rate = the realised P25 at the **most
  competitive lender in our data** — labelled *"best rate borrowers actually
  report."* It is a **peer figure, not a quote and not the advertised floor**, and
  (unlike the reprice door) it is drawn across all borrowers at that lender, so it
  is **not** scoped to your exact profile — the copy says so. Cost stack = the new
  lender's processing/takeover fee **+** MOD/stamp (~0.15% of loan) **+** ~₹7,500
  legal/valuation.
- **Neither** (the neutral state). When no option nets a positive benefit, the
  screen shows *"the economics right now"* instead of an option — no move, no
  contradiction.

### 5.3 Net benefit — shown, not recommended
For each option: **net = (interest saved over remaining tenure) − (all costs)**.
An option is shown only when its **net is positive** (it genuinely saves money
after costs); if both qualify, **both are shown, side by side, unranked**. There is
**no "recommended" door, no highlight, and no minimum-benefit threshold** — the old
₹25,000 cutoff and the single-recommendation logic were removed. Each option always
shows its **costs**, never a gross saving alone, and a collapsible *"Show me the
calculation in detail"* panel exposes the full working (outstanding, remaining
term, both rates, EMI now vs. lower, total interest each way, itemised costs, net).
*(`app.js` `computeDoors`, `renderResult`, `doorHtml`, `calcDetail`)*

### 5.4 Fee honesty
Fees are the lender's **verified** figure where we have it (from their official
MITC / schedule of charges), a **third-party estimate** where they don't publish
one, and a labelled **assumption** as the last fallback. Whenever any estimate is
used, the screen says so and tells the user to **verify exact fees with the bank
before acting**.

---

## 6. Where the benchmark numbers come from

Crowd data (what borrowers report) is one stream. The **benchmark** figures used
to verify submissions and show "advertised vs achievable" are a *separate* stream
and must be **sourced, never guessed**:
- **Repo rate** → RBI (currently **5.25%**, confirmed against the RBI MPC).
- **RLLR / advertised floor** → each bank's own rate-card / disclosure page.
- Every benchmark row carries a **source URL and an as-of date** as required
  fields — an unsourced number physically cannot enter the table.

Benchmarks are kept in an append-only history, so the reference used is always the
one that was true at the relevant time. *(`0009`–`0013`, `benchmark_history`)*

---

## 7. Anonymity & security (how identity never leaks)

- The browser's database role has **zero direct table access** — it can't read a
  single raw row. Every read goes through a function that returns **only
  aggregates**; every write returns **only an id**.
- Your `user_id` (and old `session_id`) is used **only** for anti-spam and is
  **never returned** by any read. Names/emails live in the auth system, which the
  public API never touches.
- So: sign-in gives us a verified identity to fight spam, and simultaneously
  **every viewer still sees anonymous aggregates only**. The two are not in
  tension. *(`0001` security model, `0014`)*

---

## 8. Honest limitations (read this part twice)

For the logic to be *legit*, these have to be stated plainly:

1. **Outstanding balance: entered or estimated.** We ask the loan tenure (so the
   remaining term is real) and let you enter what you still owe. If you leave the
   balance blank, we estimate it assuming **no prepayment** and label it as an
   estimate — so someone who prepaid heavily should enter their real balance for
   an accurate figure. The full working (outstanding, remaining term, EMI now vs.
   lower, total interest each way, itemised costs, net) is shown on-screen in the
   collapsible "Show me the calculation in detail" panel — no email is collected.
2. **Fees vary and some are estimates.** We label which are verified vs estimated
   and always say "verify with your bank." A wrong fee would mislead a net-benefit
   figure, which is why every door shows its costs and the disclaimer.
3. **Self-reported data.** Rates are what people *say* they got. The outlier/median
   defences, the ≥4-report floor, and sign-in raise the cost of bad data, but they
   don't make it impossible — the system gets *more* reliable as volume grows, not
   less.
4. **Thin data widens the comparison.** Early on, most people will be compared to
   "all borrowers at your bank" (tier 6), not their exact profile. The screen
   always says when it has widened, so the user knows how tight the match is.
5. **Benchmarks must be refreshed when the RBI repo moves.** Floating loans reset
   to the current benchmark; if the repo rate changes, the benchmark rows need
   updating or the "pricing context" line drifts.
6. **P25 is a realistic target, not a promise.** It's what the better-priced
   quarter of similar borrowers report — achievable for many, but your eligibility
   (score, income, employer) decides your actual offer.

---

## 9. Quick verification map (for an engineer's spot-check)

| Concern | Where to look |
|---|---|
| Submission + identity + supersede | `supabase/migrations/0014_auth_identity.sql` → `submit_rate` |
| Cohort tiers & widening | `0008_ticket_band.sql` / `0012_cohort_normalization.sql` → `cohort_stats` |
| Outlier / median-MAD defence | `0008` → `reclassify_bank_outliers` |
| Rate limit & revocation | `0014` → `enforce_rate_limit`, `banned_users` |
| Door math & options shown (no recommendation) | `app.js` → `computeDoors`, `renderResult`, `doorHtml`, `calcDetail` |
| Benchmark sourcing | `0009`–`0013`, `seed_benchmarks.sql`, `benchmark_history` |
| No-raw-row security | `0001` (RLS + security-definer RPCs), `README.md` §Security |

---

**Bottom line on soundness:** the comparison is peer-relative (not vs marketing
floors), it refuses to show anything from thin data, it drops bad data with a
method resistant to coordinated fakes, and it always shows costs alongside savings.
It **presents every worthwhile option with its full numbers and leaves the decision
to the reader — it makes no recommendation and facilitates nothing**, which keeps
it an information service rather than an adviser or agent. Its honest weak points
are the balance estimate, fee estimates, and self-reported data — all disclosed to
the user rather than hidden. That combination is what makes it fair to put in front
of real borrowers.
