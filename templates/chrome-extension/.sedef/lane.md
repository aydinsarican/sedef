# Lane: Chrome extension (Manifest V3)

- Phase 01 scaffolds Vite + TypeScript with `public/manifest.json`, `npm run build` → `dist/`, `npm run zip` → `dist/<slug>.zip`.
- Rules: single purpose, narrowest permissions (prefer `activeTab`), no remote code, privacy tab matches behavior, affiliate links disclosed.
- Contracts: Playwright specs in `tests/acceptance/` that load the unpacked extension in a persistent Chromium context.
- Payments: own checkout (Paddle/Polar) + license key check; the free tier must work offline.
- Icons: generate 16/32/48/128 px PNGs from `design/brand/icon-1024.png` (`sips -z 128 128 design/brand/icon-1024.png --out public/icons/icon-128.png`, …) and list them in the manifest.
- Publishing: Chrome Web Store API v2 for existing items; the first listing is a human chore that returns the item id (`.sedef/chore-answers.json`).
