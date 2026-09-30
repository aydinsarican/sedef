---
description: Take over a factory product by hand — pause it in the foreman and orient in its phase-runner state
argument-hint: <product-slug>
---

The human wants to work on product `$ARGUMENTS` themselves.

1. Tell them to pause the product in the factory first (Telegram: `/dur` for everything, or `sedef kill $ARGUMENTS` if they want the factory to stop working on it permanently) — you cannot run factory control commands yourself.
2. Orient exactly like the phase-runner protocol: read `STATUS.md`, the active `docs/phases/phase-XX.md`, `docs/DECISIONS.md`, `.sedef/progress.json`, the last session note and `git log --oneline -10`.
3. Summarize in Turkish: where the product is, what the last factory session did, open blockers and chores, and the next concrete step.
4. From here, work in normal interactive mode with the human. When they hand it back, update STATUS.md and `.sedef/progress.json` so the next factory session can continue.
