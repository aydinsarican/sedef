---
name: build-loop
description: Use in the factory's build stage (and for any autonomous phase work) — the phase-runner protocol adapted for sessions with no human — one phase per fresh session, evidence-based verification, the independent evaluator handoff, documented stand-ins for human-only blockers, commit conventions and the give-up path.
---

# Build loop — phase-runner, autonomous edition

This is the phase-runner protocol (STATUS.md dashboard, `docs/phases/phase-XX.md`, `docs/DECISIONS.md`) with the human removed from the loop and replaced by rules. If the `phase-runner` skill is installed, its conventions apply; where it says "stop and ask the user", follow the overrides below instead.

Why fresh sessions: long sessions rot — context fills with stale detail, early mistakes compound, and agents declare victory early. One phase per session, with all state in files and git, is what the most reliable long-running setups converged on.

## Protocol (every session)
1. **Orient.** `STATUS.md` → active phase; `.sedef/progress.json`; last session note; `git log --oneline -10`; `.sedef/feedback/build.md` (why the previous attempt failed — fix that first). Resume a 🟡 phase; never restart it.
2. **Load one phase.** Only `docs/phases/phase-XX.md` for `progress.current`. Don't read ahead "for context".
3. **Blockers — autonomous overrides.**
   - Open ❓ decision the phase needs → decide it yourself using the brief/spec as tiebreaker; record 🤖 with rationale and how to reverse.
   - Human-only prerequisite (store products not created yet, a paid account, legal text needing sign-off) → add a chore to `.sedef/chores.json` and continue with a **documented stand-in** when one exists: StoreKit configuration file instead of live products, a local Supabase instead of the hosted project, placeholder legal URL pointing to the product's own `site/` page. List every stand-in in STATUS.md "Human Setup" and in the phase's evaluation. If no honest stand-in exists, mark the phase ⛔ in STATUS.md, write the chore with `"blocking": true`, and stop.
4. **Implement strictly in scope.** Tokens from DESIGN.md, screens per `design/ui-spec.md`, motion per `design/motion.md`. Discoveries outside scope → STATUS.md "Backlog".
   Parallelize independent chunks with subagents (`sedef:ios-engineer`, `sedef:cross-platform-engineer`, `sedef:web-engineer`), each with a precise task, files it owns, and how to verify. You integrate and own the result.
5. **Verify with evidence.** `bash .sedef/verify.sh quick` (build + unit tests). Then `bash .sedef/verify.sh acceptance phase-XX` (the phase's immutable contracts). Save screenshots/logs to `.sedef/evidence/phase-XX/`. Fix causes, never weaken tests. If a contract is genuinely wrong (it contradicts the spec or the platform), write the case with evidence in `.sedef/verifier-issues.md`; do not edit it.
6. **Independent evaluation.** Spawn a fresh `sedef:evaluator` with:
   > Phase file: docs/phases/phase-XX.md. Features: F…, F…. Evidence: .sedef/evidence/phase-XX/. Commands I ran: … . Verify every acceptance criterion yourself and, only if all pass, update feature_list.json, progress.json and write .sedef/evaluations/phase-XX.md.
   If it rejects, fix and ask again (a fresh evaluator each time).
7. **Checkpoint (✅CP).** Clean build from scratch, launch smoke on the simulator (or the built site), commit. A failed gate means the phase is not done.
8. **Book-keeping.** STATUS.md phase table + known issues + session note:
   `- YYYY-MM-DD · Phase N (✅|🟡|⛔): what was done. Next: … Blockers: none|…`
9. **Commit** logically: `feat(phase-N): …`, `fix(phase-N): …`, `test(phase-N): …`, `chore(phase-N): …`. No secrets, no generated build folders.
10. **Stop.** One phase per session. The foreman rejects a session whose `phases_done` did not increase.

## Stop gate
When you try to finish, the foreman runs `bash .sedef/verify.sh quick`. If it fails you'll be told to continue (at most twice). Don't fight the gate: fix the build, or, if it truly can't be fixed in this session, write the root-cause analysis in STATUS.md and `.sedef/notes.md` and stop.

## Give-up path (better than burning budget)
Same criterion failing three times, or the phase needing a design/spec change → write `.sedef/verifier-issues.md` or a "Re-plan request" section in STATUS.md with evidence and a proposed change. After repeated failures the foreman routes the product back to spec automatically.

## Never
Placeholder content in shipping code, fake data presented as real, tests that assert nothing, catching and swallowing errors to make a test pass, disabling a failing test, editing verifiers or contracts, hard-coded secrets, reading credential files.
