# Mission · Portfolio review — where the factory's next week of money goes

Factory job · {{today}} · working folder `{{paths.factory}}`

## Portfolio
{{portfolio}}

## Method — load `sedef:launch-and-grow` (portfolio rules) and `sedef:lanes`
1. For every product, read its latest `growth/latest.md`, `.sedef/grow.json`, STATUS.md and spend (product folders are under the products directory; paths are in the portfolio lines above or `ls` the products dir). When a live product's numbers are older than a week, have a `sedef:growth-analyst` subagent refresh them — reporting into `reports/`, not into the product repo.
2. Classify each live product: **double_down** (clear traction: retention and/or revenue above the skill's thresholds) · **iterate** (a specific, testable bet exists) · **keep** (observe) · **sunset** (the sunset rule is met). For parked products (status failed): **unpark** only if the cause is fixed or the budget case is strong, otherwise **kill**.
3. Lane mix: which lanes are paying back per dollar of agent spend? Recommend lane weight changes in the report (the human edits config; you don't).
4. Factory health: spend vs. outcomes, stages that fail most, recurring App Review issues, anything that needs the human's attention this week.

## Output contract
- `portfolio/decisions.json` = `{"decisions":[{"product":"<slug>","action":"double_down|iterate|keep|sunset|unpark|kill","reason":"…"}],"summary_tr":"<5–8 Turkish lines for the human: what's working, what's not, what you changed, the one thing they should know>"}`
- `reports/portfolio-{{today}}.md` — the full reasoning with numbers.

## Rules
Be unsentimental and numeric. Say "not enough data" when it's true. Do not modify product repos.
