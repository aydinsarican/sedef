---
description: Summarize the Sedef factory — products by stage, spend, chores waiting for the human
---

Run `sedef status` and `sedef chores` and summarize for the human in Turkish:

1. One line per product: stage, status, spend, what it is waiting for.
2. Chores waiting for the human, ordered by how much they unblock, with the exact `/tamam <id>` to close each.
3. Anything unusual in the last day (parked products, repeated retries, budget alerts) — read `factory/logs/foreman.log` tail if needed.

Keep it short; do not change anything.
