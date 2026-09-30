# Lane: Expo (iOS + Android)

- Phase 01 — scaffold without prompts (create-expo-app refuses a non-empty folder and would add its own agent files):
  ```bash
  CI=1 npx -y create-expo-app@latest "/tmp/sedef-expo/{{PRODUCT_SLUG}}" --template blank-typescript --no-agents-md --no-install
  rsync -a --exclude .git --exclude .claude --exclude AGENTS.md --exclude CLAUDE.md "/tmp/sedef-expo/{{PRODUCT_SLUG}}/" ./ && npm install
  ```
  Then Expo Router, Reanimated; set `ios.bundleIdentifier` and `android.package` to `{{BUNDLE_ID}}`; theme from DESIGN.md tokens.
- Icons: `design/brand/icon-1024.png` → `assets/icon.png` and `assets/adaptive-icon.png` (Android foreground; keep the glyph inside the central 66%), referenced from app.json `icon` / `android.adaptiveIcon`.
- Every interactive element: `testID` = the feature list's `accessibility_ids` (Maestro contracts use `id:` selectors).
- Verifier: `quick` = typecheck + lint + tests; `acceptance` = `expo prebuild` → CocoaPods → Release simulator build (JS bundled) → Maestro. Requires CocoaPods (`brew install cocoapods`).
- Release: EAS Build/Submit non-interactive after the first human setup; Play production needs the human chores in `sedef:release-ops`.
