# Lane: web SaaS / landing

- Phase 01 scaffolds the app (Astro for content-led products, Next.js for apps), exports DESIGN.md tokens (`npx -y @google/design.md@0.4.0 export --format css-tailwind DESIGN.md`), and adds `playwright.config.ts` with a `webServer` block so `npx playwright test` starts the app itself.
- Scripts the verifier expects in package.json: `build` (required), optionally `typecheck`, `lint`, `test:unit`.
- Contracts: `tests/acceptance/<feature-id>.spec.ts`, test titles tagged `@phase-XX`, elements addressed with `getByTestId`.
- Verifier: `bash .sedef/verify.sh <contract|quick|acceptance phase-XX|full|store>`; `full` also runs `impeccable detect` on `$SLOP_DIR` (default `src`).
- Favicon and social image from `design/brand/icon.svg` / `icon-1024.png` (`public/favicon.svg`, `apple-touch-icon.png` 180 px, `og.png` 1200×630).
- Payments: Paddle by default, Polar after a successful test payout (see `sedef:lanes`).
- Deploy: `vercel deploy --prod --yes --token "$VERCEL_TOKEN"` or `npx wrangler deploy` (release stage).
