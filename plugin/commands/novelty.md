---
description: Check the current product's brand fingerprint against the factory novelty ledger
---

Run `sedef novelty check .sedef/fingerprint.json` in the current product repo and explain the result:

- If it passes: the minimum distance and the nearest past product.
- If it fails: each violation, and the smallest change that would fix it (a different draw on one constraint-deck axis, a different typeface, a primary color at least the required OKLab distance away). Use the `sedef:taste-engine` skill for the re-draw rules.

Do not edit DESIGN.md or the fingerprint unless the human asks.
