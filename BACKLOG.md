# Backlog

## CardEngine

- [ ] **Cross-category shared cap does not cover `channel_conditional` upside (surfaced by CC20
      SmartBuy accelerators).** `sharedCapId` pooling only clamps base-row
      `perCategory[cat].guaranteed`; `channel_conditional` rows compute `.upside`
      independently per row via `applyPerCategoryCap`, with no cross-category upside-pooling
      mechanism. A real fix needs to (1) extend pooling to cover `.upside` for
      `channel_conditional` rows, gated so it doesn't also start clamping the currently-uncapped
      base guaranteed earn on Online/Travel, and (2) handle two different `redeemValue`s (0.35 vs
      0.5) sharing one RP-denominated ₹ cap. **Concrete case:** CC20 (HDFC Regalia Gold)'s Online
      5X and Travel 10X rows share a real combined SmartBuy ceiling of 4,000 RP/month + 2,000
      RP/day across all SmartBuy-accelerated categories (per HDFC SmartBuy T&C), but are stored
      today as two independent per-row caps (Online ₹1,750/mo, Travel ₹25,000/mo) with no
      `sharedCapId` between them — documented in each row's `sourceNote` as unstored-but-verified
      (Part-1 PR, Fix A, Option 3: document-only). There is also no engine field for the daily cap.
      This must appear in every future handover until resolved.

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

- [x] **FIXED (PR #167, merged July 2026).** Priorities panel now renders every populated lounge block,
      stacked one per line, each with its own threshold/unlock state; unlimited blocks keep
      their type label; below-threshold blocks read "you can't access this lounge". Fixed in
      both `evalLounge()` and `priLine()`; status semantics unchanged (still best-across-blocks),
      so no scoring impact. Verified on all 7 dual-lounge cards + single-lounge regression.
      Original finding preserved below for reference.

      **Original finding — Priorities panel: lounge display omits all but one block.** Found during
      CC20 (Regalia Gold) fresh-incognito verification, July 2026. Both
      `evalLounge()` (`evaluatePriorities.ts`) and `priLine()`'s Lounge branch
      (`ResultsScreenV2.tsx:340-417`) iterate all three lounge blocks
      (domestic/international/railway) but return only the single best-ranked
      block, using rank = 2 (no spend condition) > 1 (condition met) > 0
      (condition unmet). Confirmed on all 7 dual-lounge cards (CC16, CC20, CC22,
      CC25, CC27, CC31, CC32) — every one drops a populated block: CC20/CC16 show
      international (unconditional), omit domestic (conditional); CC22/CC25 show
      domestic (tie, evaluated first), omit international; CC27/CC31/CC32 show
      whichever unlimited block ranks first, omit the other. Data is NOT the
      problem — e.g. CC20's domestic lounge (3/qtr, ₹60k spend gate) is correctly
      populated and simply unreachable at any spend level, because an unconditional
      international block always outranks a conditional domestic one. Sub-issue,
      same function: for unlimited-visit blocks the quantity string drops the
      domestic/international label entirely (CC27/CC31/CC32 render "unlimited free
      visits a year — no conditions" with no indication of which lounge type). Fix
      direction: render all populated lounge blocks, not the single best-ranked one
      — requires changes in both `evalLounge()` and `priLine()` (see the
      parallel-implementation note in the entry below). Severity: display
      *incompleteness*, not a false claim — the shown block is accurate, just
      incomplete. Lower priority than the entry below.

- [ ] **Priorities panel: "gives you nothing back" conflates ₹0 user spend with a
      card that excludes the category — an actively FALSE user-facing claim, live in
      production. FLAG TO PARTH FOR AN EXPLICIT PRIORITY CALL, not routine triage.**
      Found during CC20 (Regalia Gold) fresh-incognito verification, July 2026.
      `card.earn.perCategory` only contains categories present in
      `Object.keys(monthlySpend)` (`computeCardEarn`). `evalCategory()`/`priLine()`
      key off `guaranteed` (= rate × user spend), not the card's actual rate. So a
      priority category where the user entered ₹0 spend has `perCategory[cat]`
      absent → `guaranteed ?? 0` → status "unmet" → renders "gives you nothing back"
      — IDENTICAL output to a genuinely `excluded: true` category (e.g. Fuel on CC20,
      which really does earn nothing). Verified directly on CC20: with ₹0
      Dining/Travel spend entered, both show ✗ "gives you nothing back" despite CC20
      earning 0.875%/1.25%+ on those categories; with nonzero spend entered, both
      correctly flip to ✓ "gives you back ₹X/yr". Same pattern confirmed on CC22,
      CC31, CC18 under zero-spend-in-priority-category profiles — not CC20-specific.
      Downstream propagation, same root cause, wider blast radius: (1)
      `evalPriorityForCard.status` drives met/missed grouping
      (`ResultsScreenV2.tsx:499-510`) → a card with ₹0 entered spend in a priority
      category lands in `missedKeys` → the verdict sentence states "Doesn't cover
      your [Category]" — a FALSE claim about the card, not the user's spend entry.
      (2) `findAlternativeForMissedTop` requires `status: 'met'` to suggest an
      alternative — impossible when no card can earn on a category with ₹0 entered
      spend — so the alt-finder silently no-ops for every zero-spend priority
      category, on every card, with no error or fallback. SEVERITY — distinct from
      the lounge entry above: this is not incomplete display, it is an ACTIVELY FALSE
      claim ("doesn't cover your Travel" on a card that does), live now on every
      card × every zero-spend priority combination, and it contradicts the product's
      core "honest, no-agenda claims about what a card does for you" positioning. Fix
      direction: distinguish `excluded: true` (card genuinely earns nothing here)
      from `perCategory[cat]` absent due to ₹0 spend (rate simply untested by this
      profile) before choosing status/copy — the two cases need different phrasing
      and must not both collapse to met/missed the same way.
      **Maintenance-smell note (applies to both priorities-panel entries above):**
      `evalPriorityForCard` supplies only `.status` (glyph + met/missed grouping);
      the actual on-screen text comes from a SEPARATE, parallel implementation,
      `priLine()` in `ResultsScreenV2.tsx`, which ignores `evaluatePriorities.ts`'s
      own `.line` field entirely. The two can and do disagree. Any real fix to either
      entry above should touch both implementations or consolidate them into one
      source of truth — don't patch one and leave the other stale.

- [ ] **`perCategory[cat].notes` (PR #159) only renders in the new-card journey —
      the owned-card journey's "See the numbers" panel is a separate component
      that structurally can't show it without additional work.** Confirmed via
      grep: `CardMathBreakdown` (the component PR #159 modified) has exactly 2
      usage sites, both new-card-journey (`ResultsScreenV2.tsx`'s hero non-combo
      "The math" tab, and `RecommendationCard.tsx`'s alt-card detail view, itself
      only used in new-card-journey contexts). The owned-card journey's
      "See the numbers" expandable panel is a distinct, bespoke inline renderer
      inside `ResultsScreenV2.tsx` that never calls `CardMathBreakdown` and has no
      equivalent notes-rendering logic. This is the SAME shape of gap as the
      redemption-panel and pros/cons gaps already logged above (a fix landing in
      one journey's surface with no equivalent in the other) — not fixed in
      PR #159, intentionally scoped out. Building the owned-journey equivalent
      is a real, separate piece of work if this parity is wanted.

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

## CC20 (HDFC Regalia Gold) — Part 2 / second-pass notes

Deferred from the Part-1 score-affecting PR (Fixes A/B/C/G/F/H). Not started.

- [ ] **Fix D — `milestoneBenefit` schema extension (own PR).** CC20 has two concurrent
      milestone programs the current single-`period` `MilestoneBenefit` shape can't hold at once:
      quarterly voucher (₹1.5L spend → ₹1,500 Myntra/Nykaa/Reliance Digital/Marriott, choice) and
      annual flight voucher (₹7.5L spend → ₹5,000, anniversary-year = 365 days from setup/last
      up/downgrade, NOT calendar year). Needs a reviewed schema change (array of programs) with
      loader/engine handled in lockstep. When it lands: (1) fix the now-stale comment at
      `rankCards.ts:461` ("No-op today: milestoneBenefit is null on all 40" — CC11 and CC18
      already carry live `milestoneBenefit` data and feed `milestoneCreditPerYear`); (2) add a
      distinct anniversary-year-vs-calendar-year period label to the extended schema even though
      there's no live calc bug today (`milestoneCreditPerYear` has no calendar-date logic — it
      only divides annual spend by a period count — and no frontend renders `milestoneBenefit`
      yet, confirmed via grep).

- [ ] **pros text — quarterly milestone line under-lists brands.** CC20 `pros` currently reads
      "₹1,500 Myntra/Nykaa vouchers" (2 brands); the Milestone Benefits T&C lists Myntra/Nykaa/
      Reliance Digital/Marriott (4, cardholder choice). Folds into the Fix E prose reconciliation.

- [ ] **Hack H020 redeemValue mismatch.** H020 ("Buy brand vouchers on SmartBuy...") stores
      `rateWithHack: 6.67 / rateWithoutHack: 1.33`, which back-solve to an implied redeemValue of
      ~0.40 — matching neither 0.35 (voucher) nor 0.5 (SmartBuy travel), and independent of the
      Fix C earnRow bug. Pre-existing error in the hack itself; confirmed out of scope for the
      Part-1 PR, logged here for the second-pass hacks review. Also note H020's headline rates
      predate the 15 May 2026 base rate cut (5 RP/₹150→₹200) applied to earnRows in Part 1.
