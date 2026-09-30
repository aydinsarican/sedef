# Mission · Spec "{{product.title}}" — contracts the builders cannot argue with

Stage `spec` · attempt {{attempt}} · {{today}} · lane `{{product.lane}}`
Read first: `.sedef/brief.md`, `.sedef/verdict.json`, `.sedef/idea.json`, `CLAUDE.md`, and the lane notes in `.sedef/lane.md` if present.

## Feedback from the previous attempt — fix these first
{{feedback}}

## Re-plan? (re-plans so far: {{product.replans}})
If that number is above 0, the build got stuck and handed the product back to you. Read `.sedef/feedback/build.md`, `STATUS.md`, `.sedef/progress.json`, `docs/phases/` and `git log --oneline -30` before anything else. Then:
- **Keep what works.** Done phases stay done (`phases_done` unchanged), features the evaluator passed keep `passes:true`, and their contracts stay untouched.
- **Re-cut only the remaining work**: smaller phases, a simpler technical approach, or scope moved to "Later". Update `phases_total` and `current`, write the new phase files, and note the re-plan in `docs/DECISIONS.md` (🤖, with what failed and why the new cut avoids it).
- Brand and design are kept: after you pass, the product goes straight back to build.

## Goal
Turn the validated brief into a small, sharp v1 with machine-checkable acceptance contracts.
These contracts become immutable during the build: they are how the factory knows the product works without a human looking at it.

## Method — load `sedef:product-spec` and follow it exactly
Delegate drafting of acceptance flows to a `sedef:product-architect` subagent if the feature list is long; you own the result.

1. `.sedef/spec.md` — lean PRD: problem · segment · wedge · v1 scope (≤ 5 features) · non-goals ("Later") · success metrics (activation, D7 retention, trial→paid) · paywall placement and price · analytics events · privacy data map (what data, why, where it goes — this drives the store privacy label) · AI usage and consent, if any.
2. `.sedef/feature_list.json` — array of `{"id","title","phase","user_story","acceptance":[…testable statements…],"accessibility_ids":[…],"passes":false}`. Every acceptance statement must be checkable by a test or a screenshot.
3. Phases in the phase-runner convention: `docs/phases/phase-01.md` … `phase-NN.md` (4–8 phases; phase-01 is foundation: project generation, design tokens from DESIGN.md placeholder, CI verify green). Each phase file: Goal (Amaç) · Scope (Kapsam) · Out of scope (Kapsam DIŞI) · Acceptance criteria (Kabul kriterleri) · ✅CP marker where a full build + smoke is required.
4. `STATUS.md` (phase table ⬜🟡✅⛔, Human Setup, Known issues, Session notes) and `docs/DECISIONS.md` (✅ locked, 🤖 auto-decided with rationale and how to reverse, ❓ only for human-only matters — which must also become chores).
5. `.sedef/progress.json` = `{"phases_total": N, "phases_done": 0, "complete": false, "current": 1}`.
6. Acceptance contracts:
   - iOS / Expo lanes → `.maestro/acceptance/<feature-id>.yaml` Maestro flows using `id:` selectors from `accessibility_ids`; tag each flow with its phase (`tags: [phase-02]`).
   - Web / extension lanes → `tests/acceptance/<feature-id>.spec.ts` Playwright specs.
   Contracts describe behavior the user sees, never implementation details.
7. Do not rewrite `.sedef/verify.sh` (it ships with the lane). Configure it through `.sedef/project.env` if needed.

## Exit check (the foreman runs these; make them pass before you stop)
- The files above exist; feature_list is non-empty; on a first plan every feature has `passes:false` and progress starts at 0 (on a re-plan, done work is kept and at least one phase remains).
- `bash .sedef/verify.sh contract` passes.

## Rules
- Scope for ≤ 6 build sessions. Cut ruthlessly; list the cuts under "Later".
- No human will answer questions. Decide, record 🤖 in DECISIONS.md, move on.
- Human-only needs (accounts, agreements, legal entity) → `.sedef/chores.json` entries (see `sedef:release-ops` for the format), never silent stubs.
