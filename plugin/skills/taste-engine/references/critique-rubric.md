# Critique rubric (brand, screens, store assets)

Score each criterion 1–5 with one sentence of concrete evidence ("the paywall's price line is lighter than the legal copy", not "hierarchy could improve").
**Pass = average ≥ 4.0 and no criterion below 3.** Judge fit and distance — not personal taste, not "best".

| # | Criterion | 1 | 3 | 5 |
|---|-----------|---|---|---|
| 1 | **Brief fit** — would the segment in `.sedef/brief.md` recognize this as for them? | generic or wrong audience | plausible | unmistakably for them |
| 2 | **Distinctiveness** — distance from the ledger's recent products and from category leaders | could be any app in the category | some own traits | recognizable from one cropped screenshot |
| 3 | **Hierarchy & clarity** — the eye knows first/second/third; the primary action is obvious | confusing | readable | effortless |
| 4 | **Typographic quality** — pairing, scale, rhythm, line length, numerals | default/awkward | competent | expressive and disciplined |
| 5 | **Color craft** — roles, contrast (AA), restraint, dark mode designed | muddy or inaccessible | correct | memorable and correct |
| 6 | **Motion & delight** — a signature moment that fits the motion character; Reduce Motion honored | none or gratuitous | present | a moment people would screenshot or share |
| 7 | **Accessibility** — Dynamic Type/zoom, VoiceOver/labels, touch targets, contrast | fails basics | meets basics | exemplary |
| 8 | **Platform nativeness** — respects navigation, safe areas, system chrome (Liquid Glass), gestures | fights the platform | respectful | native and still branded |
| 9 | **Cohesion** — icon, screens, copy and store assets feel like one product | disjointed | mostly consistent | one voice everywhere |

Output for `design/critique.json`:
```json
{"verdict": "pass|fail", "average": 4.2, "lowest": 3, "scores": {"brief_fit": 5, "distinctiveness": 4, "hierarchy": 4, "typography": 4, "color": 5, "motion": 3, "accessibility": 4, "nativeness": 4, "cohesion": 5}, "notes": "…top three fixes…"}
```
