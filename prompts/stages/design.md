# Mission · Design "{{product.title}}" — screens, motion and a critique that passes

Stage `design` · attempt {{attempt}} · {{today}} · lane `{{product.lane}}`
Read: `DESIGN.md` (immutable now — it is the contract), `.sedef/direction.md`, `.sedef/spec.md`, `.sedef/feature_list.json`.

## Feedback from the previous attempt — fix these first
{{feedback}}

## Goal
Design every v1 screen and state so a builder can implement it without taste decisions, in the product's own direction — not the platform default, not the last product.

## Method — load `sedef:taste-engine` (critique part), `sedef:swiftui-craft` for iOS/Expo or `sedef:web-craft` for web lanes
1. **Flows first.** From feature_list: onboarding (value before sign-up), core loop, paywall (honest), empty/loading/error states, settings (restore purchases, privacy, support). Write `design/ui-spec.md`: per screen — purpose, layout, components (by DESIGN.md token names), copy (EN + TR), states, accessibility identifiers (must match feature_list `accessibility_ids`).
2. **Explore divergently, then converge.** Brief `sedef:ui-designer` subagents in parallel, one flow each (e.g. onboarding · core loop · paywall + settings), and ask for two clearly different variants of the two most important screens. Where Stitch or Figma MCP servers are available, use them for the variants; otherwise prototype directly (SwiftUI previews rendered via the simulator, or HTML rendered with Playwright). Pick by the rubric and merge their entries into one `design/ui-spec.md`.
3. **Render key screens** to `design/screens/<nn>-<name>.png` (at least: onboarding, core screen, paywall, one empty state) at the lane's primary device size.
4. **Motion.** `design/motion.md`: motion character from the direction, spring parameters, durations, 3–5 signature interactions, haptics map, Reduce Motion alternatives.
5. **Critique.** Critic available: {{critic_enabled}}. Otherwise a `sedef:evaluator` subagent scores screens with `{{paths.plugin}}/skills/taste-engine/references/critique-rubric.md` (give it that path). Write `design/critique.md` (scores, issues, fixes applied) and `design/critique.json` = `{"verdict":"pass|fail","average":0.0,"lowest":0,"notes":"…"}`. Pass requires average ≥ 4.0 and no item below 3.

## Output contract
`design/ui-spec.md` · `design/motion.md` · `design/screens/*.png` · `design/critique.md` · `design/critique.json` with `verdict: pass`.

## Rules
- Tokens only from DESIGN.md. If the system truly lacks something, write it in `.sedef/verifier-issues.md`; do not edit DESIGN.md.
- References inform principles; never copy another product's layout or visuals.
