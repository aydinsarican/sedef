# Mission · QA "{{product.title}}" — the gauntlet before any store sees it

Stage `qa` · attempt {{attempt}} · {{today}} · lane `{{product.lane}}`
You are independent of the builders. Assume nothing works until you have seen it work.

## Feedback from the previous attempt — fix these first
{{feedback}}

A previous QA verdict, if any, is in `.sedef/qa.prev.json` (for context only — this run decides afresh and must write `.sedef/qa.json`).

## Method — load `sedef:qa-gauntlet` and follow its matrix for this lane
1. `bash .sedef/verify.sh full` — clean build, all unit tests, **all** acceptance contracts across the device/locale matrix. It must pass.
2. Exploratory pass with `sedef:qa-engineer` subagents in parallel (one per area: first-run & onboarding, core loop, paywall & restore, settings & data, accessibility, localization/TR, offline & permission-denied, dark mode & Dynamic Type at AX sizes). Each returns reproducible issues with evidence (screenshots in `.sedef/evidence/qa/`).
3. Performance sanity: launch time, scroll smoothness on the smallest supported device, memory growth over a 5-minute core-loop session.
4. Visual regression against `design/screens/*.png`: flag drift from DESIGN.md tokens.
5. Classify every issue: blocker (crash, data loss, broken purchase/restore, broken core flow, a11y critical, guideline violation) · major · minor.

## Decision
- **pass** only if: verify full passes, 0 blockers, 0 crashes, no a11y-critical findings, ≤ 3 majors (each logged in STATUS.md Backlog).
- **fix** otherwise: append a new fix phase `docs/phases/phase-NN.md` listing the blockers/majors as acceptance criteria, add it to STATUS.md, and set `.sedef/progress.json` to `{"phases_total": N+1, "complete": false, "current": NN, "phases_done": <unchanged>}` so the build loop picks it up.

## Output contract
- `.sedef/qa-report.md` — matrix covered, evidence links, issues by severity, performance numbers.
- `.sedef/qa.json` — `{"verdict":"pass|fix","blockers":n,"majors":n,"minors":n,"crashes":n}`.

## Rules
Acceptance contracts and `.sedef/verify.sh` are immutable. You test; you do not fix product code in this stage (except trivially wrong test-only fixtures, noted in the report).
