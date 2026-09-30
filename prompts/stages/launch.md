# Mission · Launch "{{product.title}}" — get it in front of its first 100 users

Stage `launch` · attempt {{attempt}} · {{today}} · lane `{{product.lane}}` · app ids: {{product.app_ids}}
Read `.sedef/brief.md` (the distribution plan from validation), `.sedef/verdict.json`, `DESIGN.md`, `metadata/`.

## Feedback from the previous attempt — fix these first
{{feedback}}

## Method — load `sedef:launch-and-grow` (launch part) and the Remotion skill if installed
1. **Landing page** in `site/` (web-craft rules, the product's own direction, store badges, privacy/terms links) — deploy it (`vercel deploy --prod --yes --token $VERCEL_TOKEN` or `wrangler deploy`); if no token is configured, leave it built and add a chore.
2. **Launch assets** in `launch/`: press kit (icon, 3 screenshots, one-paragraph pitch in EN + TR), 15–30 s social video (Remotion over real captures; generated footage is fine for ads only), 3 image posts in the product's direction.
3. **Channel plan** executing the brief's first-100-users plan: for each channel, the exact post/draft, timing, and the community's self-promotion rules. Drafts only for communities and platforms that forbid automated posting (Reddit, Product Hunt, forums) — those become one chore with ready-to-paste text.
4. **Paid acquisition (optional):** an Apple Ads plan (exact-match keywords from ASO, max CPT, daily cap) as a chore — paid spend is a human decision in v0.1.
5. **Measurement:** confirm analytics events fire (from the spec) and write the baseline to `.sedef/launch.json`.

## Output contract
`launch/launch-plan.md` · `launch/` assets · `.sedef/launch.json` = `{"landing_url":"…|null","channels":[…],"chores":[…],"baseline":{…}}`.

## Rules
No fake reviews, sock puppets, bot accounts, astroturfing, review gating or incentivized ratings. Respect each community's rules; when in doubt, it's a chore for the human.
