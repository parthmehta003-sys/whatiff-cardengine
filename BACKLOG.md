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

- [ ] **`redemption.plainSummary`/`redemption.caps` are unreachable for every
      pure-`cashback`-currency card, in both journeys.** Found while verifying CC12
      (`ResultsScreenV2.tsx` "Redeem points" panel, ~line 1145). The panel only
      exists in the owned-card journey (`hasRedemption` is gated on
      `activeOwnedCard`; the new-card/recommended journey has no equivalent
      surface at all). Inside that panel, `optimizeRedemption()` sets
      `isCashback: true` whenever `redemption.currency === 'cashback'`
      (`optimizeRedemption.ts:108`), and the JSX branch taken for
      `isCashback === true` (`ResultsScreenV2.tsx:1158-1161`) renders a **hardcoded
      generic sentence** ("Nothing to redeem — cashback is automatic. It credits
      straight to your bill…") instead of `redemption.plainSummary`, and never
      renders `redemption.caps` at all (that block lives only in the non-cashback
      `else` branch). Confirmed live for CC12: after correcting `plainSummary` to
      describe the statement-credit/next-cycle-lag mechanics and populating
      `caps` with the 1-cycle-lag note, neither string appears anywhere in the
      rendered app — verified via Playwright in both the owned-card Redeem-points
      tab and by checking the new-card journey has no redemption panel at all.
      This affects every card whose `redemption.currency` is `"cashback"` (not
      CC12-specific) — the structured data is still more correct/honest than
      before, but is currently write-only. Fix means either passing
      `redemption.plainSummary`/`redemption.caps` through in the `isCashback`
      branch, or adding a new-card-journey surface for redemption text.
