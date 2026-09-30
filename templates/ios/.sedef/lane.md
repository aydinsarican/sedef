# Lane: iOS (native SwiftUI)

- Project: XcodeGen (`project.yml`) → `xcodegen generate`; the `.xcodeproj` is generated and git-ignored.
- Stack: Swift 6, SwiftUI, @Observable, SwiftData (+CloudKit if sync), RevenueCat, TelemetryDeck — the `sedef:swiftui-craft` skill has the details. If `lanes.ios.template_repo` points at the team's BaseApp, its files and CLAUDE.md rules were merged in and take precedence.
- Contracts: `.maestro/acceptance/<feature-id>.yaml` (Maestro, `id:` selectors, `tags: [phase-XX]`, `appId: ${APP_ID}`).
- Verifier: `bash .sedef/verify.sh <contract|quick|acceptance phase-XX|full|store>` — reads `.sedef/project.env`.
  - `quick`: generate + build + unit tests on the newest iPhone simulator (override with `SIM_UDID`).
  - `acceptance phase-XX`: build, install, run the phase's Maestro contracts.
  - `full`: clean build, all tests (unit + UI), all contracts.
  - `store`: metadata validates, screenshots exist, icon has no alpha, privacy page exists.
- App icon: the factory copies `design/brand/icon-1024.png` into `AppIcon.appiconset` (single 1024 universal icon) when the brand stage passes — don't replace it with a placeholder.
- Release: `sedef:release-ops` (asc CLI + xcodebuild archive/export with `.sedef/ExportOptions.plist`).
