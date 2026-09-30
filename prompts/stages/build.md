# Mission · Build "{{product.title}}" — exactly one phase, verified, committed

Stage `build` · session attempt {{attempt}} · {{today}} · lane `{{product.lane}}`
This session is one iteration of a fresh-context loop: finish and verify **one** phase, then stop. The next session continues from the files, not from memory.

## Feedback from the previous attempt — fix these first
{{feedback}}

## Protocol — load `sedef:build-loop` (autonomous phase-runner) and the lane craft skill (`sedef:swiftui-craft` or `sedef:web-craft`)
1. **Orient.** Read `STATUS.md`, `.sedef/progress.json`, `git log --oneline -10`, the last session note, and `.sedef/feedback/build.md` if it exists. If a phase is 🟡, resume it; do not restart.
2. **Load exactly one phase**: `docs/phases/phase-XX.md` for `progress.current`. Do not read ahead.
3. **Blockers.** Human-only prerequisites → add to `.sedef/chores.json` and, when the skill allows, continue with a documented local stand-in (e.g. a StoreKit configuration file until store products exist). Open ❓ decisions → resolve yourself as 🤖 in `docs/DECISIONS.md` with rationale.
4. **Implement within scope**, following DESIGN.md tokens and `design/ui-spec.md`. Out-of-scope discoveries go to STATUS.md "Backlog", not into code.
5. **Verify with evidence.** `bash .sedef/verify.sh quick` must pass. Then `bash .sedef/verify.sh acceptance phase-XX` for this phase's contracts. Fix causes, not tests.
6. **Independent judgment.** Spawn a `sedef:evaluator` subagent with the phase file, the acceptance criteria and the evidence (command output, screenshots in `.sedef/evidence/`). Only the evaluator may update `.sedef/feature_list.json` (`passes`), `.sedef/progress.json` (`phases_done`, `current`, `complete` — it must write `complete` every time; the foreman clears it when a build visit starts) and `.sedef/evaluations/`. If it rejects, fix and ask again.
7. **Checkpoint (✅CP phases).** Clean build + launch smoke + commit; the gate must pass before the phase counts.
8. **Book-keep.** Update STATUS.md (phase table, known issues, dated session note). Commit `feat(phase-N): …` in logical chunks.
9. **Stop.** One phase per session. The foreman will not accept a session that finishes no phase.

## Hard rules
- `.sedef/verify.sh`, `.maestro/acceptance/**`, `tests/acceptance/**` and `DESIGN.md` are immutable here; edits are reverted and the attempt fails. If a contract is genuinely wrong, explain in `.sedef/verifier-issues.md` with evidence — the spec stage fixes contracts.
- No placeholders, lorem ipsum, fake data presented as real, or silent stubs in shipping code.
- Never hard-code secrets. Never read credential files.
- No human will answer; decide and record.
