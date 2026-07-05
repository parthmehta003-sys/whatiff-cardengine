# Backlog

## CardEngine

- [ ] `cardIntelligence()` (selectHacks.ts) does not filter warnings by `triggerWhen`.
      Warnings are matched only by card/issuer name in the text. Any `triggerWhen`
      condition (e.g. `user_owns_card`) is ignored. W006's current suppression is
      coincidental, not principled — fix by filtering on `triggerWhen` against the
      user/ownership context before depending on it. (Latent; no user-facing bug today.)

## UI / display-field verification gaps

- [ ] **pros/cons/tips prose is unreachable for every already-owned card.** The
      narrative block (curated top-pros/cons + "See full pros & cons" → full modal)
      only populates for cards in `result.recommended` — the Journey B hero/combo
      pick, or a Journey A *suggested addition*. It never populates for a card
      already reviewed as owned in Journey A. Practically: the entire pros/cons/tips
      field category has been structurally unverifiable-by-rendering for every
      already-owned card closed so far — any prose fix to an owned card's pros/cons
      is correct-on-paper but currently invisible to that card's own owner in the
      app. Blocks calling this field category's verification fully closed until
      either the UI is extended to show pros/cons for owned cards too, or the
      verification standard is explicitly revised to acknowledge this scope limit
      rather than silently assuming "light review" (per the schema-mapping table in
      `docs/card-data-automation-scoping.md` §6) means "renders somewhere."
      **Precise retroactive scope:** CC10, CC11, CC16, and CC27 all had prose changes
      shipped and verified via the new-card journey only (hero slot or combo alt
      card) — the owned-card journey's pros/cons rendering was never explicitly
      checked one way or the other for any of them, only assumed to generalize from
      the new-card result. This is a gap in verification **already performed and
      reported as done**, not merely a risk description for future cards — worth a
      look if any of those four cards' prose is revisited.

- [x] **FIXED (follow-up to PR #150).** `redemption.plainSummary`/`redemption.caps`
      were unreachable for every pure-`cashback`-currency card, in the owned-card
      journey's "Redeem points" panel (`ResultsScreenV2.tsx` ~line 1145 — this
      panel only exists in the owned-card journey by design; the new-card journey
      has no equivalent surface, confirmed intentional, not a gap). Root cause:
      `optimizeRedemption()` sets `isCashback: true` whenever
      `redemption.currency === 'cashback'` (`optimizeRedemption.ts:108`), and the
      JSX branch taken for `isCashback === true` rendered a **hardcoded generic
      sentence** instead of `redemption.plainSummary`, and never rendered
      `redemption.caps` at all. Fixed by rendering `redemption.plainSummary` and
      `redemption.caps` (when present) inside the `isCashback` branch instead of
      the hardcoded string. Affected 5 cards total: CC05, CC07, CC12, CC14, CC19
      (every card with `redemption.currency === "cashback"`, single method, no
      real redemption choice). CC11 was never affected — its `currency` is
      `"cashback-points"` with 2 real methods (SmartBuy vs statement cashback),
      so it never hit the `isCashback === true` branch; its original "confirmed
      rendering correctly" verification stands. Verified live post-fix: CC12 now
      shows its statement-credit/1-cycle-lag text, CC19 shows its own distinct
      plainSummary, and CC11's SmartBuy/balance-input flow is unchanged
      (regression-checked).

- [ ] **CC11 (HDFC MoneyBack+) cannot reach the new-card journey's hero/"Also
      considered" slot under any spend profile tried.** Found while render-checking
      the CC11 fee-schedule sweep (cons item 8). Tried 4 materially different
      profiles: light targeted online+grocery spend, heavy grocery-only spend,
      heavy multi-category spend at high income (₹2L/mo), and fuel-heavy spend with
      Fuel set as the priority (CC11 earns ₹0 on fuel by design, so this one was
      never going to work, but tested for completeness). In every case CC11 didn't
      win the hero slot and didn't appear in the `runnersUp` list, which is
      hard-capped to `RELEVANCE_RUNNERS` (4) entries in `rankCards.ts` — CC11's
      weak base rate (~0.25%, 10X capped modestly) can't compete with the other
      ~40 cards' guaranteed-earn numbers under realistic spend. Separately
      confirmed via code: even if CC11 *did* land in "Also considered," that list
      (`ResultsScreenV2.tsx` ~line 1560) has no per-card pros/cons access at all —
      only the hero card (and the combo second card) get the "Pros & cons" tab /
      "See full pros & cons" modal. So CC11's `cons`/`pros` prose is *not*
      currently verifiable as rendering in the new-card journey under any profile
      — combined with the pre-existing owned-journey pros/cons gap (above), this
      means CC11's prose changes are correct-on-paper but not user-visible in
      either journey today. Not a bug to fix here (CC11 genuinely doesn't deserve
      to win against stronger cashback cards) — just a verification-reachability
      fact worth knowing before assuming any future CC11 prose change "renders
      somewhere."

- [ ] **CC13 (HDFC Freedom) has the same new-card-journey unreachability as CC11.**
      Found during CC13's Phase 2 verification. Tried 2 spend profiles (BigBasket
      + Dining heavy at moderate income; a generic Grocery+Dining+Utility mix at
      low income) — CC13 never won the hero slot and never appeared in the
      4-entry "Also considered" runners-up list in either. Same root cause as
      CC11: its effective rate (0.75% on 5 bonus merchants, capped low; 0.075%
      elsewhere) can't compete with the ~40 other cards' guaranteed-earn numbers.
      This means CC13's `pros`/`cons` prose corrections (Dineout discount line,
      Rent/Fuel/Utility/Education fee figures) are correct-on-paper but not
      user-visible in the new-card journey — combined with the pre-existing
      owned-journey pros/cons gap (above), not user-visible in either journey
      today. `welcomeBenefit` and `fuelWaiver` ARE independently confirmed
      rendering correctly in the owned-card journey (Things-to-know no-op as
      expected for welcomeBenefit; fuelWaiver shows correctly under Fuel
      priority) — only the free-text prose is affected by this gap. Likely true
      of every weak entry-level HDFC card (CC13, and presumably others still to
      be verified) — worth keeping in mind rather than re-discovering per card.
