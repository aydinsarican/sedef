---
name: launch-and-grow
description: Use for launches, weekly growth reviews and portfolio decisions in the factory — the launch kit, honest channel playbooks, the Apple Ads plan format, funnel metrics, review replies, ASO iteration, and the numeric rules for iterate / double down / sunset.
---

# Launch & grow

Nobody finds a product by accident. Plan the first 100 users like a feature; measure the funnel weekly; move money toward what works; let go of what doesn't.

## Launch kit
- **Landing page** in the product's own direction (see `sedef:web-craft`), store badges, privacy/terms/support.
- **Press kit:** icon, 3 screenshots, one-paragraph pitch (EN + TR), founder-free boilerplate, contact = support e-mail.
- **Short video** (15–30 s): Remotion over real captures; for ads, generated footage is acceptable.
- **Channel plan** from the brief's first-100-users section. For each channel: exact copy, timing, the community's self-promotion rules, and whether it's automatable.

## Channels — honest playbook
| Channel | Automate? | Notes |
|---|---|---|
| App Store search (ASO) | yes | the compounding channel; iterate monthly |
| Own landing page + SEO for real utility queries | yes | never mass-generated pages |
| Niche communities (subreddits, forums, Discords) | **draft only → chore** | read the rules; lead with the problem, disclose you built it, answer comments |
| Product Hunt / Hacker News "Show HN" | **draft only → chore** | needs a human maker account and presence on launch day |
| Social (X, LinkedIn, Instagram, TikTok) | only with official APIs and accounts the human set up | one account per product voice; no bots, no engagement pods |
| Newsletters, directories, "alternatives to X" lists | draft pitches → chore | personalized, short |
| Apple Ads | **plan → chore** in v0.1 | the human owns spend decisions |

Never: fake reviews, sock-puppet accounts, astroturfing, incentivized ratings, review gating, buying followers.

## Apple Ads plan (chore content)
Campaign per storefront; exact-match keywords from ASO research (brand terms separate); max CPT based on estimated trial→paid × price; daily cap; discovery campaign with search match at a low CPT; review after 7 days: pause keywords with CPA above target.

## Weekly growth loop (`grow` stage)
1. Funnel for 7 and 28 days: impressions → page views → installs → activation → D1/D7 → trial → paid; revenue, refunds, crashes.
2. Reviews: reply to every 1–3★ with specifics; route recurring issues to the backlog. Never promise dates.
3. ASO: change one thing at a time (a caption, a keyword third); keep a log in `growth/aso-log.md`.
4. Pick the leakiest influenceable stage → **one bet** with a target and a date.
5. Small numbers: fewer than ~100 events in a window is anecdote — say so and keep observing.

## Portfolio rules (defaults; tune in the weekly review)
- **Double down** when D7 retention ≥ 25%, or trial→paid ≥ 8%, or revenue ≥ $300/month and growing for 3 weeks → localization to more storefronts, a second feature phase, Apple Ads plan.
- **Iterate** when there is a clear leak and a testable bet.
- **Keep** when data is too thin to decide.
- **Sunset** when live ≥ 45 days AND average organic installs < 3/day over 28 days AND no week-over-week growth in the last 3 reviews AND revenue < $50/month. Sunset keeps the app live and maintained for OS compatibility; the factory stops investing.
- **Kill** parked products whose cause isn't fixable cheaply.

Lane weighting: compare revenue (and leading indicators) per dollar of agent spend by lane every week; recommend weight changes to the human in the portfolio report.
