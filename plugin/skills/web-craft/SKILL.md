---
name: web-craft
description: Use when building web products in the factory — landing pages, web SaaS, browser extensions, Expo web UI — with DESIGN.md tokens, the anti-slop gate, accessibility and performance budgets, payment rails that work from Turkey, and Chrome MV3 rules.
---

# Web craft

## Stack defaults
- **Landing/content:** Astro. **Apps:** Next.js (App Router). **Extensions:** Vite + TypeScript, Manifest V3. **Data/auth:** Supabase (row-level security on from day one). TypeScript strict everywhere.
- **Styling:** Tailwind v4 with the theme exported from DESIGN.md:
  ```bash
  npx -y @google/design.md@0.4.0 export --format css-tailwind DESIGN.md > src/styles/tokens.css
  ```
  shadcn/ui only as unstyled primitives, restyled to the tokens — its default zinc/rounded look is on the anti-cliché list.
- **Payments:** Paddle (merchant of record, default) or Polar.sh after a successful test payout; license keys for extensions and desktop apps. Stripe does not onboard Turkish entities directly — see `sedef:lanes`.

## Quality gates (run before claiming a phase done)
1. `npx impeccable detect --json src/` → fix every primary finding (exit 2 = findings). Record deliberate exceptions with `npx impeccable ignores add-value <rule> <value> --reason "…"`.
2. Accessibility: semantic landmarks, visible focus, full keyboard path, AA contrast, `prefers-reduced-motion` honored; `@axe-core/playwright` in the acceptance run where possible.
3. Performance budget on a mid-range mobile profile: LCP < 2.5 s, CLS < 0.1, JS < 170 KB gzipped on first load; self-host fonts with `font-display: swap` and size-adjusted fallbacks.
4. Acceptance contracts in `tests/acceptance/**` (Playwright, `getByTestId`) pass.

## Landing page structure (per product, in its own direction)
Promise in the segment's words → proof (real screenshots, not mockups that misrepresent) → the wedge vs alternatives → how it works (3 steps) → pricing with the real terms → FAQ → store badges/CTA → footer with privacy, terms, support e-mail. One primary CTA per viewport.

## SEO without spam
Real utility pages (tools, calculators, templates) that answer a query completely; structured data where it applies; unique OG images generated per page from the brand system. Never mass-generate thin pages — Google's scaled-content-abuse policy is enforced repeatedly and it would sink the domain.

## Chrome extensions (MV3)
- Single, clearly stated purpose; the minimum permissions and host permissions (prefer `activeTab`); no remote code; all logic bundled.
- Privacy tab answers must match behavior; since 1 Aug 2026 data-collection limits are stricter — collect nothing you don't need.
- Affiliate links require disclosure and real user value (2025 policy).
- Payments via your own checkout + license check; free tier works offline.
- Package with a reproducible `npm run build && npm run zip`; publishing uses the Chrome Web Store API v2 (V1 shuts down 15 Oct 2026). The first listing is a human chore.

## Deploy
`vercel deploy --prod --yes --token "$VERCEL_TOKEN"` or `npx wrangler deploy`. Environment variables through the platform, never in the repo. Preview first, smoke-test, then promote.
