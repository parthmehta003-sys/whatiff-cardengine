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

## 12. Per-card verification checklist (before any card is declared closed)

`tsc --noEmit` passing and `loadCardDB` validators passing confirm the data is *structurally*
valid — they say nothing about whether a user ever sees the thing that changed. Before a card's
data PR is treated as closed (not just merged), confirm all three:

- **(a) Prose-vs-structured-data consistency.** For every new or corrected structured fact in the
  PR, check whether `pros`/`cons`/`tips` already describes it, contradicts it, or omits it. A
  structured field and its prose description drifting apart silently is exactly the kind of gap
  this checklist exists to catch — it's cheap to check and easy to miss.
- **(b) An actual live-render pass, not just green checks.** Load the change (dev server + browser,
  not `tsc`/validators alone) and describe what was actually seen — which screen, which tab, what
  the number/text said. If some part of the change can't be reached in the current UI for that
  specific card (wrong journey, card isn't eligible to reach the surface that would show it, etc.),
  say so explicitly and explain why. "Nothing to check" must never quietly become "didn't check."
- **(c) Visual confirmation for every "no-op" claim.** If a field is claimed to be invisible/no-op
  based on a code search (e.g. "no component reads this"), that claim still gets one line of live
  visual confirmation — a code search proves the code doesn't reference the field; it doesn't prove
  what a user actually sees.

See `BACKLOG.md` for known scope limits this checklist has already surfaced (e.g. pros/cons/tips
being unreachable-by-rendering for already-owned cards).

## 13. Open decisions

- Source of truth after Fix 1: single `cardDB.json` vs per-card files?
- Cadence: weekly vs monthly?
- Where do emailed MITC PDFs land (mailbox integration vs manual upload)?
- Who is the approver of record for score-affecting PRs?
