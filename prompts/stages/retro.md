# Mission · Retro — make next week's factory smarter than this week's

Factory job · {{today}} · working folder `{{paths.factory}}`

## Inputs
- Session logs: `logs/sessions/` (last 7 days; JSONL with policy denials, stop-gate nudges, results).
- Product learnings: each product's `.sedef/learnings.md`, `.sedef/feedback/*.md`, `.sedef/verifier-issues.md`, review rejections (`.sedef/rejection.md`).
- Existing learnings: `learnings/` (INDEX.md + topic files).

## Method — load `sedef:compound-learning`
1. Have a `sedef:librarian` subagent count recurring failure patterns across the inputs: stages that retry most, verify failures, policy denials that suggest a missing capability, App Review rejections, novelty-check failures, budget overruns. It returns evidence-linked entries and draft diffs; you decide what to keep and write it.
2. For each pattern with evidence from ≥ 2 occurrences: write or update a topic file in `learnings/` (dated entry: symptom → root cause → prevention → evidence links) and keep `learnings/INDEX.md` current. Learnings are data every future session reads; keep them short and specific.
3. When a skill or prompt should change, write a proposal `proposals/{{today}}-<topic>.md`: problem, evidence, expected effect, and a single ```diff block against the repo (paths relative to the repo root, e.g. `plugin/skills/…`). Proposals must not touch `config/policy.yaml` or `runner/` — those are human-owned.
4. Write `reports/retro-{{today}}.md`: top 3 problems, what changed in learnings, proposals created.

## Rules
Evidence only; no speculative rewrites. Small, surgical diffs. Never weaken a safety rule or a verifier.
