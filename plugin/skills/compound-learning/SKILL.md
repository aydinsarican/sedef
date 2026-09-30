---
name: compound-learning
description: Use in the weekly retro and whenever a stage fails for a reason that could recur — how to turn failures, rejections and denials into short evidence-linked learnings every future session reads, and into surgical skill-change proposals a human applies with one tap.
---

# Compound learning

Every unit of work should make the next one easier. The factory remembers through files, not through model weights: `factory/learnings/` is read by every session; skills change only through reviewed proposals.

## Learning entries — `factory/learnings/<topic>.md`
Topics are stable nouns: `app-review.md`, `xcode-builds.md`, `maestro.md`, `store-assets.md`, `naming.md`, `pricing.md`, `distribution.md`, `policy-denials.md`.
```markdown
## 2026-10-04 · Subscription paywall rejected (3.1.2)
- Symptom: rejection "missing Terms of Use link" on 2 products (tide, lumen)
- Root cause: paywall template put legal links only in Settings
- Prevention: paywall must show Terms + Privacy under the price; compliance-reviewer checks it
- Evidence: products/tide/.sedef/rejection.md, products/lumen/.sedef/rejection.md
```
Rules: a pattern needs ≥ 2 occurrences (or one catastrophic one); one entry per pattern, updated rather than duplicated; keep entries under ~8 lines. Keep `learnings/INDEX.md` as a one-line-per-topic table of contents with the date of the newest entry.

## Proposals — `factory/proposals/<date>-<topic>.md`
When prevention belongs in a skill or stage prompt:
~~~markdown
# Paywall legal links
Problem: …  Evidence: …  Expected effect: fewer 3.1.2 rejections.
```diff
--- a/plugin/skills/swiftui-craft/SKILL.md
+++ b/plugin/skills/swiftui-craft/SKILL.md
@@ …
```
~~~
One diff block per proposal, paths relative to the repo root, smallest change that works. The human applies it with `/uygula <n>` (or `sedef proposals apply <n>`); `git apply --check` must pass.

## Never
- Touch `config/policy.yaml` or `runner/` (proposals that do are refused automatically).
- Weaken a verifier, a contract rule or a safety rule — even if it "keeps failing". Failing verifiers are information.
- Record secrets, personal data, or anything a reviewer or user wrote verbatim beyond a short phrase.
