# Backlog

## CardEngine

- [ ] `cardIntelligence()` (selectHacks.ts) does not filter warnings by `triggerWhen`.
      Warnings are matched only by card/issuer name in the text. Any `triggerWhen`
      condition (e.g. `user_owns_card`) is ignored. W006's current suppression is
      coincidental, not principled — fix by filtering on `triggerWhen` against the
      user/ownership context before depending on it. (Latent; no user-facing bug today.)
