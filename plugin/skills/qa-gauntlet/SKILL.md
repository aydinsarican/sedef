---
name: qa-gauntlet
description: Use in the factory's QA stage or whenever testing a product end to end — the device/locale/appearance matrix, simulator and browser commands, exploratory charters, performance sanity checks, severity rules and ship criteria.
---

# QA gauntlet

Assume nothing works until you have seen it work on the smallest device, in Turkish, in dark mode, with huge text, offline, with permissions denied.

## Matrix
| Axis | iOS / Expo | Web / extension |
|---|---|---|
| Size | smallest supported iPhone, a standard iPhone, the largest Pro Max; iPad if universal | 360 px mobile, 768 px tablet, 1440 px desktop |
| Appearance | light, dark | light, dark (`prefers-color-scheme`) |
| Text | default, accessibility XL | 200 % zoom |
| Locale | en-US, tr-TR | en, tr |
| State | fresh install, upgrade from previous build, offline, permissions denied, low storage messaging | first visit, returning user, offline, blocked third-party cookies |
| Engines | — | Chromium, WebKit, Firefox (Playwright projects) |

## Simulator commands (iOS)
```bash
xcrun simctl list devices available            # pick UDIDs for the matrix
xcrun simctl boot <udid>
xcrun simctl ui <udid> appearance dark
xcrun simctl ui <udid> content_size accessibility-extra-large
xcrun simctl status_bar <udid> override --time 9:41 --batteryState charged --batteryLevel 100 --wifiBars 3 --cellularBars 4
xcrun simctl launch <udid> <bundle-id> -AppleLanguages "(tr)" -AppleLocale tr_TR
xcrun simctl io <udid> screenshot .sedef/evidence/qa/<name>.png
xcrun simctl io <udid> recordVideo .sedef/evidence/qa/<name>.mov   # Ctrl-C / kill to stop
```
MobileBuildMCP gives the same through tools (`build_run_sim`, `test_sim`, `snapshot_ui`, `tap`, `type_text`, `screenshot`). Maestro runs the contracts:
```bash
maestro test --platform ios --device <udid> -e APP_ID=<bundle-id> --format junit --output .sedef/evidence/qa/report.xml --test-output-dir .sedef/evidence/qa/maestro .maestro/acceptance/
```

## Exploratory charters (one `sedef:qa-engineer` each)
1. First run & onboarding — value before sign-up, skip paths, back navigation.
2. Core loop — create/edit/delete, undo, large data (1,000 items), unicode and Turkish characters (İ, ı, ğ, ş).
3. Paywall & restore — purchase (StoreKit test/sandbox), cancel, restore on a fresh install, entitlement gating, terms/privacy links.
4. Settings & data — export, delete account/data, support link, notification toggles.
5. Accessibility — VoiceOver order and labels, Dynamic Type reflow, contrast, Reduce Motion, touch targets.
6. Localization — truncation, plural forms, date/number formats, RTL not required unless scoped.
7. Resilience — offline, airplane mode mid-action, backgrounding mid-flow, permission denied then granted in Settings.
8. Visual — compare to `design/screens/*.png`: token drift, misaligned grids, clipped text.

## Performance sanity
- Cold launch to first meaningful screen on the smallest device: target < 1 s.
- Scroll 1,000 items: no visible hitches (MobileBuildMCP screen recording or Instruments `xctrace` if available).
- Memory: no steady growth over a 5-minute core-loop session.
- Web: Lighthouse mobile — Performance ≥ 90, Accessibility ≥ 95, Best Practices ≥ 95.

## Severity & ship criteria
- **Blocker:** crash, data loss, broken purchase/restore, core flow unusable, accessibility-critical (unlabeled primary control, unreadable primary text), store-guideline violation.
- **Major:** visible defect on a common path; wrong locale strings; layout break at accessibility sizes.
- **Minor:** polish.
Ship (`verdict: pass`) only with 0 blockers, 0 crashes, ≤ 3 majors (logged in Backlog), `verify.sh full` green.
