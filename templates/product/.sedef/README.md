# `.sedef/` — factory state for this product

| File | Written by | Purpose |
|---|---|---|
| `idea.json` / `idea.md` | foreman | the approved idea card |
| `brief.md`, `verdict.json` | validate | evidence, go/kill, lane, wedge, price, first-100-users plan |
| `spec.md`, `feature_list.json`, `progress.json` | spec (progress/feature passes: evaluator only during build) | scope, contracts, scoreboard |
| `verify.sh` + `project.env` | lane template (+ spec for `project.env`) | the deterministic verifier the foreman runs |
| `direction.md`, `naming.md`, `fingerprint.json` | brand | art direction, name, novelty fingerprint |
| `evaluations/`, `evidence/` | build / QA | judge reports and proof |
| `qa-report.md`, `qa.json` | qa | test matrix, verdict (a previous verdict is kept as `qa.prev.json`) |
| `store-plan.md`, `compliance.json` | store | listing plan, policy audit |
| `release.json`, `review-status.json` | release / release_watch | shipping state (the foreman clears `release.json` → `status` when a release visit starts) |
| `rejection.md`, `rejections.md` | human (`/red`) or review_fix | the rejection to fix now; earlier ones |
| `launch.json`, `grow.json` | launch / grow | launch baseline, weekly decision |
| `chores.json` | any stage | outbox for steps only a human can do — the foreman takes them after each session and empties it |
| `chores-history.json`, `chore-answers.json` | foreman | what was asked, and the human's answers (`/tamam <id> [value]`) |
| `feedback/<stage>.md` | foreman | why the previous attempt failed |
| `learnings.md`, `notes.md`, `verifier-issues.md` | any stage | lessons, notes, contract problems |
