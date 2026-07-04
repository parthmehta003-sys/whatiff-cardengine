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
