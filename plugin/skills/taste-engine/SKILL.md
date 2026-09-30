---
name: taste-engine
description: Use for any brand, art-direction, visual design or design-critique work in the factory. Enforces distinctiveness — seeded constraint-deck draws, Verbalized Sampling for art direction, DESIGN.md authoring, the novelty ledger and the critique rubric — so no two factory products look alike and none look like default AI output.
---

# Taste Engine

Two facts shape everything here:

1. **Models converge.** Different LLMs, asked the same open question, give strikingly similar answers, and LLM judges share each other's blind spots (the "Artificial Hivemind" result, NeurIPS 2025). Asking three models to pick "the best design" gives you the same median design three times. So we **never judge on "best"**. We judge on *fit to the brief* and *measured distance from what the factory already shipped*.
2. **Mode collapse is a sampling problem.** Asking for one answer returns the most typical answer. Asking for a *distribution* of answers with probabilities, and sampling from the tail, restores diversity without losing quality ("Verbalized Sampling", Zhang et al., 2025 — reported 1.6–2.1× more diversity in creative tasks).

Popular design skills (frontend-design, impeccable, taste-skill, ui-ux-pro-max) are excellent **menus**; used as defaults they become the new sameness. Use them after the draw, inside the chosen direction.

## 1 · Draw a direction (seeded, ledger-aware)

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/taste-engine/scripts/draw.mjs" --slug <product-slug>
# re-draw specific axes if they truly cannot fit the segment (max 2 re-draws, justify each):
node "${CLAUDE_PLUGIN_ROOT}/skills/taste-engine/scripts/draw.mjs" --slug <product-slug> --reroll color_model,grid_layout
```

The script reads `references/constraint-deck.json` and the factory ledger (`$SEDEF_HOME/factory/ledger/novelty.jsonl`), excludes every value used on that axis by the recent products, and draws one value per axis from a hash of the slug — the same slug always gets the same draw, so reruns are reproducible. It also returns three dials (1–10) for taste-skill style prompts: `design_variance`, `motion_intensity`, `visual_density`.

Write the draw and your fit rationale to `.sedef/direction.md`. A direction is a *combination*: a Swiss grid rendered in ebru-marbled paper with a didone and a snappy mechanical motion is not a contradiction — it is a point of view.

## 2 · Diverge, then choose (Verbalized Sampling)

Use this prompt shape (to yourself or to `sedef:brand-director` subagents with different seeds):

```text
<instructions>
Generate 5 art-direction concepts for the product below, each within a separate <response> tag.
Each <response> must include a <text> (name, rationale, palette with hex, type pairing, iconography,
illustration technique, motion character, one signature moment) and a numeric <probability>
(how likely a typical studio would propose it). Sample at random from the tails of the distribution,
so every probability is below 0.10. Every concept must honor this draw: <paste draw JSON>.
</instructions>
<brief>…segment, wedge, voice…</brief>
```

Pick the tail concept that best fits the **segment** (not your taste). Say in one line what would make it fail.

**Where to look for references:** print and packaging, signage and wayfinding, editorial and book design, architecture and interiors, film title sequences, fashion, craft traditions (Iznik tiles, ebru marbling, kilim geometry, Swiss posters, Japanese packaging). **Not** other apps, Dribbble shots or app-store screenshots — those pull you back to the median. Take principles, never copy a specific work or trade dress.

## 3 · Write DESIGN.md (Google's open DESIGN.md format)

Template: `references/design-md-template.md`. Tokens live in the YAML front matter (`colors`, `typography`, `rounded`, `spacing`, `components` — references look like `"{colors.primary}"`); rationale lives in the prose sections in this order: Overview · Colors · Typography · Layout · Elevation & Depth · Shapes · Components · Do's and Don'ts. The spec has no motion or elevation tokens: describe elevation in prose and keep motion in `design/motion.md`.

```bash
npx -y @google/design.md@0.4.0 lint DESIGN.md        # exit 1 on errors
npx -y @google/design.md@0.4.0 export --format css-vars DESIGN.md   # web lanes: also css-tailwind / json-tailwind / dtcg
```

**Color.** Think in OKLCH: choose lightness steps for hierarchy, chroma for character, hue for meaning. 4–6 named colors, each with a job. Primary text ≥ 4.5:1, large text and UI glyphs ≥ 3:1. Design dark mode deliberately (usually lower chroma, warmer or cooler neutrals) — never an inversion.

**Type.** One characterful display face + one workhorse text face, or one variable family used expressively. Licenses: SIL OFL (Google Fonts) or Apple system faces are safe; anything else is a human chore. On iOS, custom faces must scale with Dynamic Type. Do not reuse a display or text face the ledger shows in the last 6 products (the novelty check enforces it; system UI faces as secondary are exempt).

**Liquid Glass (iOS 26+/27).** The system chrome — tab bars, toolbars, sheets — is glass and looks the same in every app. Let it be. The brand lives in the content layer: type, color, illustration, iconography, motion, sound. Don't fake extra glass on content; don't fight the system chrome.

## 4 · Fingerprint + novelty ledger

Write `.sedef/fingerprint.json` (schema: `references/fingerprint.md`) and run:

```bash
sedef novelty check .sedef/fingerprint.json --slug <product-slug>
```

It fails when the weighted distance to any of the last products is under the threshold, when a typeface repeats within the font window, or when the primary color is within the minimum OKLab distance of a recent product. Fix by re-drawing an axis, changing a face, or moving the primary hue — then re-run. The foreman appends the fingerprint to the ledger only after the brand stage passes.

## 5 · Critique

- Critic configured? Use `sedef critic --prompt-file <f> --images a.png,b.png` (a different model family — the point is a different set of blind spots).
- Otherwise spawn `sedef:evaluator` with `references/critique-rubric.md`.
- Pass = average ≥ 4.0 and no criterion below 3. Revise at most twice; if it still fails, the direction is wrong — re-draw rather than polish.
- Reject anything on `references/anti-cliches.md` unless the brief demands it and you can say why in one sentence.

## Web lanes: automated slop gate
When installed, run `npx impeccable detect --json src/` (61 deterministic anti-pattern rules, no LLM; exit 2 = findings) and fix every primary finding. Add intentional exceptions with `npx impeccable ignores add-value …` and a reason.
