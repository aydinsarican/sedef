# Lane: generic (command-driven verifier)

Used for lanes without a dedicated template (Mac direct, Apify actor, Figma plugin, digital assets).
The spec stage must set `CONTRACT_CMD`, `QUICK_CMD`, `ACCEPTANCE_CMD`, `FULL_CMD` and `STORE_CMD` in `.sedef/project.env` — real commands that exit non-zero on failure (e.g. `swift build && swift test`, `apify run --purge && node tests/acceptance/run.mjs`, `npm run build && npx vitest run`). They become immutable when the build starts.
