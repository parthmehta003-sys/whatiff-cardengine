# Card-data auto-update — scoping doc

**Status:** scoping only (no build). **Goal:** eliminate the manual "read issuer update → retype
into Excel → regenerate" loop for 40 cards across 9 issuers, without shipping unverified money data
to users.

---

## 1. Problem

Today a card change (new reward program, revised fee, updated pros/cons) requires a human to:
notice it → read the issuer page/MITC PDF → hand-edit `WhatIff_CardDB_v9.xlsx` → regenerate
`cardDB.json`. It's slow, easy to miss, and the Excel is already a generation behind
(`version: v8` from a `v9.xlsx`). The bottleneck is **detection + extraction + transcription**,
not the JSON edit itself.

## 2. Non-negotiable constraint

This is **money data** — a wrong reward rate silently misleads users about real rupees. So the
target is **automatic proposal, human approval** — never silent auto-merge of user-facing
economic fields. The "read-first → propose → approve" discipline stays; automation removes the
tedium around it, not the gate.

## 3. As-is pipeline

```
issuer site/PDF  →  [human reads]  →  edit v9.xlsx  →  build_card_db.py  →  cardDB.json  →  engine
                     (manual)         (manual)          (regen)
```

## 4. To-be pipeline

```
issuer sources → fetch → LLM-extract → diff vs current DB → open PR (+source cite)
                                                              → auto: tsc + loadCardDB validators
                                                                    + net before/after
                                                              → human approves → merge
```

Two independent fixes:

- **Fix 1 — drop the Excel middleman.** Make structured data the direct source of truth
  (`cardDB.json`, or per-card JSON/YAML that generates it). Removes regen drift; updates become
  reviewable diffs. Small, safe, valuable on its own.
- **Fix 2 — auto-propose watcher.** Scheduled job does detect + extract + diff + draft-PR. This is
  the real automation. Fits Claude Code on the web as a **cron/scheduled session** with the
  existing GitHub integration.

## 5. Sources to monitor (9 issuers, 40 cards)

| Issuer | # | Source types |
|---|---|---|
| HDFC | 9 | card pages + MITC PDFs + SmartBuy T&C |
| Axis | 7 | card pages + MITC + EDGE portal T&C |
| IDFC First | 6 | card pages + MITC (18-Jun-2026 reward change precedent) |
| ICICI | 6 | card pages + iShop T&C |
| SBI | 5 | card pages + MITC |
| HSBC | 2 | card pages + Travel-with-Points T&C |
| YES Bank | 2 | card pages |
| American Express | 2 | card pages + Membership Rewards T&C |
| Federal Bank | 1 | Scapia app/site |

**Coverage gap:** some changes ship only in **emailed MITC PDFs**, not on web pages. Those sources
must be fed in manually (mailbox/upload) — detection can't cover what isn't public.

## 6. Schema mapping — and which fields are risk-tiered

Extraction targets the existing schema (keyed by `cardId`). Fields split by blast radius:

| Field group | Location | Feeds score? | Gate |
|---|---|---|---|
| Reward rates/caps/thresholds/exclusions | `earnRows[]` | **YES** (`netGuaranteedPerYear`) | strict human review + before/after |
| Redemption methods/floors/fees | `cards[].redemption` | partial (floor) | human review |
| Fees / waiver / renewal credit | `cards[]`, `renewalCreditFloor` | **YES** | human review |
| Editorial strengths / bestFor | `strengths[]` | **ranking tiebreak** | human review (can move rankings) |
| pros / cons / tips | `cards[]` | no | light review |
| APR / EMI / interest-free / emiText | `cards[]` | no | light review |
| Lounge / movie | `*Structured` | no (priority layer) | light review |
| Transfer partners / hacks | `transfer*[]`, `hacks[]` | no | light review |

Rule: **score-affecting groups always get the automated before/after net check surfaced in the PR.**

## 7. Where the human gate sits

- **Machine does:** watch, fetch, extract, diff, draft PR with source citation, run
  `tsc`/validators/net-check, label by risk tier.
- **Human does:** review the diff (already validated), approve/merge. For display-only fields the
  review is a glance; for earn/fee/strengths it's a real check.
- **Never automated:** merging a change to earn rows, fees, redemption floors, or strengths.

## 8. Components to build (Fix 2)

1. **Source registry** — per card: URLs + PDF drop location + which sheet/fields each maps to.
2. **Fetcher** — pull pages/PDFs (Playwright already available in this env for JS-heavy pages).
3. **Extractor** — LLM prompt per issuer template → structured schema fragment + the source snippet
   it derived each value from (for citation/audit).
4. **Differ** — compare extracted vs current `cardDB.json`; ignore noise, surface real deltas.
5. **PR author** — apply deltas via the deterministic json round-trip (zero-diff-verified), open PR
   with source cites, run `tsc` + `loadCardDB` gates + engine net before/after, apply risk labels.
6. **Scheduler** — cron/scheduled session; cadence per §9.

## 9. Cost / cadence

- Issuer reward programs change **rarely** (weeks–months). A **weekly** sweep is plenty; monthly is
  defensible. Daily is wasteful.
- Cost per sweep ≈ 40 cards × (fetch + one extraction pass). Bounded and small at weekly cadence.
- Most sweeps produce **zero PRs** (nothing changed) — that's the healthy steady state.

## 10. Failure modes & mitigations

| Failure | Mitigation |
|---|---|
| Issuer page layout changes → extractor misreads | Human gate; source snippet shown in PR for cross-check |
| Change only in emailed MITC, not web | Manual PDF drop path; can't fully close this |
| Extractor hallucinates a rate | `loadCardDB` validators (silent-zero, ladder-ref) + net before/after catch gross errors; human catches subtle |
| Silent over-write of a hand-verified correction | Diff surfaces every change; nothing auto-merges |
| Extractor flips score-affecting field unnoticed | Risk-tier label + mandatory before/after net in PR |

## 11. Phased rollout (recommended)

1. **Phase 0 (Fix 1):** retire Excel; structured data = source of truth. Low risk, immediate.
2. **Phase 1:** watcher on **display-only fields** (pros/cons/tips, APR/EMI, lounge/movie) — safest
   surface to prove extraction quality with low blast radius.
3. **Phase 2:** extend to **earn/fee/strengths** with the before/after net check mandatory in every
   PR. Highest value, highest care.
4. **Phase 3:** add MITC-PDF ingestion path for changes not on public pages.

## 12. Per-card verification checklist — mandatory, every card, every PR

`tsc --noEmit` passing and `loadCardDB` validators passing confirm the data is *structurally*
valid — they say nothing about whether a user ever sees the thing that changed. This is **not**
an optional step reserved for when someone explicitly asks for it, and it is **not** a one-time
exercise CC11 happened to get — it's the standing requirement for every card's data PR, from
CC12 onward, no exceptions. Before any card's data PR is reported as ready to merge, do all four:

### (a) Prose-vs-structured-data consistency

For every field touched in the PR, check whether `pros`/`cons`/`tips` already describes the fact,
contradicts it, or omits it. Classify each as one of:

- **present & consistent** — prose already says the same thing; no action.
- **present but stale** — prose describes something that used to be true and now contradicts the
  corrected structured data (e.g. naming a transfer partner program that was renamed or dropped).
  Treat this with the **same urgency as any other factual error** — it's a correction, not a gap,
  and should be called out as such in the PR description.
- **absent** — the fact isn't in the prose at all. Flag as a gap to fill (own diff, standard
  approval gate, same as any other prose addition).

Two patterns deserve extra attention because they're easy to walk past:

- **Sibling-list gaps.** If `cons` already lists several caps/fees/exclusions in one paragraph and
  a new one belongs in that same list, its absence is a *stronger* signal than an isolated missing
  fact elsewhere — the paragraph's own existing structure is telling you where the gap is.
- **Stale program/partner names.** Whenever a transfer partner or named program changes in
  structured data (the Club Vistara → Maharaja Club class of correction), check prose specifically
  for that name — a renamed/dropped partner mentioned by name in prose is the highest-value place
  to look for a "present but stale" hit.

### (b) Live-render pass — both journeys, not just one

Load the change in a fresh incognito window (or the equivalent automated-browser flow where no
incognito path exists) and describe what was actually seen — which screen, which tab, what the
number/text said. This app has (at least) two distinct journeys with different UI surfaces, and
**both must be checked** whenever the field/panel is relevant to both:

- **New-card journey** — the card appears as a recommendation: hero slot (`result.recommended`),
  combo alt card, or the "Also considered" list. Driven by a spend/income/fee-tolerance profile.
- **Owned-card journey** — the user already holds the card. Different panels/tabs (Verdict, Pro
  Tips, Things-to-know, Redeem-points), gated differently from the new-card journey.

Report per-journey findings **separately** — never collapse two checks into a single "rendered
correctly" that in fact only exercised one path. If a field/panel is unreachable in one journey but
not the other, say explicitly which journey was checked, which one wasn't reachable, and why — same
honesty standard as the "can't be checked under any profile" rule below, just applied per journey.

If some part of the change can't be reached in the current UI at all — under any realistic spend/
income/fee-tolerance profile, in either journey — say so explicitly and explain why (e.g. the
card's guaranteed rate can't structurally win the hero slot against its competitors). **"Nothing to
check" must never quietly become "didn't check."**

Whenever a score-affecting field changed, confirm `netGuaranteedPerYear` before/after with a
concrete spend profile, not just as a structural diff claim.

### (c) Visual confirmation for every "no-op" claim

If a field is claimed to be invisible/no-op based on a code search (e.g. "no component reads
this"), that claim still gets one line of live visual confirmation. A grep proving the code doesn't
reference the field is necessary but not sufficient — it doesn't prove what a user actually sees;
confirm by attempting to observe it live too.

### Reporting format

Every PR description for a card data change includes two explicit lines summarizing (a) and (b) —
not left implicit in prose buried in the summary:

```
PROSE CHECK: <present & consistent / present but stale (corrected) / absent (added)>, per field touched
RENDER CHECK: <new-card journey: what was seen or why unreachable> | <owned-card journey: what was seen or why unreachable>
```

### Known gaps this checklist has already surfaced

See `BACKLOG.md` for the structural UI gaps found applying this checklist (pros/cons/tips
unreachable in the owned-card journey; `feePerRedemption` not shown in the Redeem-points panel).
**Retroactive note:** CC10, CC11, CC16, and CC27 all had their pros/cons prose verified only via the
new-card journey (hero slot or combo alt card) — the owned-card journey's pros/cons rendering was
never explicitly checked one way or the other for any of them, only assumed to generalize from the
new-card result. This is a known gap in **already-shipped** verification, not just a forward-looking
risk — worth a look if those cards' prose is revisited.

## 13. Open decisions

- Source of truth after Fix 1: single `cardDB.json` vs per-card files?
- Cadence: weekly vs monthly?
- Where do emailed MITC PDFs land (mailbox integration vs manual upload)?
- Who is the approver of record for score-affecting PRs?
