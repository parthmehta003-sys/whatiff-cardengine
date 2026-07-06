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

- [ ] **`optimizeRedemption`'s "Best way to use them" ranks by single-cycle usable
      value, not lifetime per-point value — can recommend a lower-value channel.**
      Found while verifying CC18's newly-added SmartBuy/Voucher/Airmiles methods.
      `evalMethod()` computes `valueRupeesFloor = usablePoints × valuePerPoint`
      where `usablePoints = min(balance, capPerCycle)` — so a heavily-capped
      high-value channel (Statement cashback: ₹1/point, capped 3,000/month) can
      rank BELOW an uncapped-or-loosely-capped lower-value channel (SmartBuy:
      ₹0.30/point, capped 50,000/month) purely because more of a large balance
      is usable THIS cycle via the looser cap. Confirmed live: at a 20,000-point
      balance, "Best way to use them" recommended SmartBuy/Voucher/Airmiles
      (₹6,000 this cycle) over Statement cashback (₹3,000 this cycle, the rest
      deferred to future months) — even though Statement cashback is the better
      long-run value at 3.3× the per-point rate. This isn't a bug in the data
      (both channels are now accurately modeled) — it's a pre-existing
      single-cycle-snapshot design choice in the optimizer that becomes more
      visible/consequential once a card has multiple channels with real,
      differentiated per-point values and caps (CC18 previously had SmartBuy
      inertly modeled with `valuePerPoint: null`, which fell through to an
      implicit ₹1/point via the "automatic cashback" fallback branch — an
      accidental near-tie with Statement cashback that masked this behavior).
      Worth deciding whether the optimizer should rank by lifetime value
      (accounting for a capped channel's value across however many cycles are
      needed to exhaust the balance) rather than single-cycle snapshot value —
      not fixed here, out of scope for a data-only pass.

- [ ] **CC18's Lounge priority evaluator has no path to `milestoneBenefit` and can't
      describe the "₹1,000 voucher OR lounge visit" either/or tradeoff.** Found during
      the priorities-section verification sweep. `evalLounge()` in
      `evaluatePriorities.ts` only reads `meta.loungeStructured` against the user's
      spend — it has no reference to `milestoneBenefit` at all. Confirmed this is
      **not a double-counting bug** (the two fields are already fully independent in
      scoring and display), but it also means a user who picks "Lounge access" as a
      priority sees only "1 domestic/quarter free visits, unlocked" with no mention
      that CC18's real benefit is a choice between that lounge visit OR a ₹1,000
      voucher (not both) at the same ₹1,00,000/quarter spend threshold. Not fixed —
      flagging for future consideration if the priorities UI is ever extended to
      describe milestone-linked alternatives.

- [ ] **Six cards (CC08, CC11, CC13, CC17, CC22, CC23) are structurally unreachable
      in the new-card journey's hero/combo/"Also considered" slots under almost any
      realistic spend profile — investigated and confirmed NOT a ranking-logic bug.**
      `rankCards.ts`'s eligibility filter, `scoreCard()`, `rankSort()`, and the
      `RELEVANCE_RUNNERS` (4) runners-up cap are applied uniformly and correctly to
      all 40 cards; the mechanism itself has no special-case bias. The six cards are
      excluded because their own `netGuaranteedPerYear` — computed correctly per the
      existing rowType/redeemValue conventions — is genuinely near the bottom of the
      40-card field. Root-caused to two independent, non-overlapping mechanisms, both
      pre-existing modeling conventions rather than bugs:
      (1) **CC11** (and to a lesser extent CC13): their entire distinctive appeal is
      modeled as `channel_conditional` rows (merchant-restricted 10X), which by
      long-standing design never feed `netGuaranteedPerYear` (upside-only). Stripped
      of that, CC11's guaranteed rate is a flat 0.25% cash-equivalent everywhere
      (2nd-lowest of all 40 cards) — confirmed via its own best-case profile
      (spend precisely sized to max out all three 10X caps): `netGuaranteedPerYear`
      = ₹396, `annualUpside` = ₹3,960 (10x higher, but upside never ranks). CC13 is
      similar but less extreme: real `base`-row guaranteed rate on Dining/Grocery is
      5% points × 0.15 redeemValue = 0.75% cash, capped at just ₹375/month — a much
      lower rate AND a much lower cap than its direct competitor HDFC Swiggy (10%,
      capped ₹1,500/month).
      (2) **CC08/CC17/CC22/CC23** (all ICICI, 4/5 of the "Under ₹500 and below"
      cluster tested): nominal "2 RP per ₹100" sounds competitive but ICICI's
      redemption floor for these cards is `redeemValue: 0.25` (a floor shared by
      many OTHER issuers' cards too — confirmed NOT ICICI-specific), so the real
      guaranteed cash-equivalent is only ~0.5% (0.25% Utility; 1.0% International on
      Sapphiro/Rubyx). Across all 40 cards ranked by average guaranteed cash rate,
      these four sit in the bottom third (ranks 11th, 12th, 13th, 13th-lowest of 39).
      **Confirmed NOT coincidental to "being one of the six flagged"**: two
      never-previously-flagged cards with equally/more weak guaranteed rates —
      CC06 Axis Neo (0.10% avg, the single worst card in the DB) and CC15 SBI
      SimplyCLICK (0.214% avg) — show the identical unreachability pattern
      (ranked outside the top 10 of ~30 in every profile tested), confirming this
      is a direct, correct function of each card's own guaranteed economics, not a
      quirk of these specific six.
      **Mathematical dominance, not just bad luck, in at least one case**: CC08
      (ICICI Platinum, ₹0 fee) can NEVER win against CC10 Scapia (also ₹0 fee),
      because Scapia's guaranteed rate (10% flat) equals or exceeds CC08's
      (0.25–0.5%) in every category CC08 covers — no spend profile, however
      contrived, can flip this while both remain ₹0-fee and eligible. CC17 is
      less absolute: dominated by same-tier CC14 Axis Ace (1.5% uncapped vs CC17's
      0.5% uncapped) in every category except Utility, but CC17 DOES eventually
      overtake CC14 into a runners-up slot at an extreme, unrealistic Utility spend
      (~₹3,00,000/month tested) — so CC17's unreachability is a narrow-realistic-
      window problem, not strict mathematical impossibility.
      **Issuer clustering (4/6 = ICICI) is coincidental to this DB's authored rates,
      not a mechanical bias against ICICI as a bank** — the 0.25 redeemValue floor
      recurs across HDFC/IDFC/SBI/YES/ICICI cards alike; ICICI's four flagged cards
      simply chose a conservative uniform ~2 RP/₹100 nominal rate rather than the
      higher merchant-specific accelerators competitors used.
      **Not fixed — explicitly out of scope for this pass** (any change to
      `netGuaranteedPerYear`'s treatment of `channel_conditional` rows or to
      redeemValue-floor conventions would affect all 40 cards' ranking, not just
      these six; flagged here as a candidate finding for review, not a to-do).
