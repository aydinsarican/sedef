---
name: swiftui-craft
description: Use when building or reviewing iOS UI in the factory — Swift 6/SwiftUI architecture (BaseApp conventions), turning DESIGN.md into a Theme, custom fonts with Dynamic Type, motion characters as spring presets, haptics, Liquid Glass done right, accessibility identifiers for contracts, paywall craft, privacy manifest, String Catalogs and on-device AI.
---

# SwiftUI craft

Craft is the moat when everyone can generate code. The system chrome (Liquid Glass bars and sheets) looks the same in every app on iOS 26+; your product is recognizable through type, color, illustration, iconography, motion and sound in the content layer.

## Stack & structure (BaseApp conventions — the product's CLAUDE.md wins where it differs)
- Swift 6 language mode, strict concurrency; iOS 18.0+ deployment unless a feature needs 26+ (gate with `if #available`).
- SwiftUI + `@Observable` view models, feature folders (`Features/<Name>/{View,Model,Components}`), services injected through `Environment`.
- SwiftData for persistence (+ CloudKit only when sync is in scope — mind the CloudKit schema rules: optional or defaulted properties, no unique constraints).
- Purchases via RevenueCat (`Purchases.configure` at launch; entitlement checks in one `PurchaseService`); TelemetryDeck for privacy-friendly analytics.
- XcodeGen `project.yml` is the source of truth; never commit hand edits to `.xcodeproj`.
- No force unwraps on user data, no main-thread I/O, no singletons for state.

## DESIGN.md → Theme
Generate `DesignSystem/Theme.swift` from DESIGN.md tokens once (phase-01) and use only it:
```swift
import SwiftUI

enum Theme {
    enum Palette {
        static let ink = Color("Ink")          // asset-catalog colors with Any/Dark variants
        static let paper = Color("Paper")
        static let primary = Color("Primary")
        static let accent = Color("Accent")
    }
    enum Space { static let xs: CGFloat = 4, sm: CGFloat = 8, md: CGFloat = 16, lg: CGFloat = 24, xl: CGFloat = 40 }
    enum Radius { static let sm: CGFloat = 6, md: CGFloat = 14, lg: CGFloat = 24 }
    enum Typeface {
        // Custom faces scale with Dynamic Type via relativeTo:
        static func display(_ size: CGFloat = 40) -> Font { .custom("Fraunces-SemiBold", size: size, relativeTo: .largeTitle) }
        static func body(_ size: CGFloat = 17) -> Font { .custom("PublicSans-Regular", size: size, relativeTo: .body) }
        static func label(_ size: CGFloat = 15) -> Font { .custom("PublicSans-SemiBold", size: size, relativeTo: .subheadline).monospacedDigit() }
    }
}
```
Bundle OFL fonts in `Resources/Fonts/` and register them in `project.yml` under the app target's `info: properties: UIAppFonts: [...]`. Verify the PostScript names (`fc-scan` or `mdls`) — a wrong name silently falls back to the system font.

## Motion characters → spring presets
Map the drawn `motion_character` to a small set of named animations and use nothing else:
```swift
extension Animation {
    static let brandSnap   = Animation.spring(response: 0.28, dampingFraction: 0.86)   // snappy-mechanical
    static let brandSettle = Animation.spring(response: 0.55, dampingFraction: 0.82)   // soft-organic
    static let brandBounce = Animation.spring(response: 0.42, dampingFraction: 0.62)   // bouncy-playful
    static let brandFade   = Animation.easeInOut(duration: 0.6)                         // slow-cinematic
}
```
Tools worth reaching for when the direction calls for them: `matchedGeometryEffect`, `PhaseAnimator`/`KeyframeAnimator` for signature moments, `symbolEffect` on SF Symbols, `scrollTransition`, `contentTransition(.numericText())` for changing numbers, `MeshGradient` (iOS 18) — sparingly. Always honor Reduce Motion:
```swift
@Environment(\.accessibilityReduceMotion) private var reduceMotion
withAnimation(reduceMotion ? nil : .brandSettle) { expanded.toggle() }
```

## Haptics
`.sensoryFeedback(.success, trigger: savedCount)`, `.selection` for pickers, `.impact(weight: .light)` for toggles. One haptic per meaningful event; none on scroll.

## Liquid Glass (iOS 26+)
Use the system: standard `TabView`, `NavigationStack` toolbars and sheets get glass automatically. For your own floating controls use `.glassEffect()`, group neighbors in `GlassEffectContainer`, and `.buttonStyle(.glass)` / `.glassProminent` for primary floating actions. Don't put glass on content cards, don't stack glass on glass, and keep text on glass high-contrast. Check the current API with DocumentationSearch/Context7 before using anything beyond these.

## Accessibility (non-negotiable; contracts depend on it)
- Every interactive element: `.accessibilityIdentifier("screen.element")` matching `feature_list.json`, plus a human `.accessibilityLabel`.
- Dynamic Type up to accessibility sizes: layouts reflow (`ViewThatFits`, `@Environment(\.dynamicTypeSize)`), nothing truncates the primary action.
- Touch targets ≥ 44 pt; contrast per DESIGN.md pairs; icons never carry meaning alone.

## Paywall craft (honest converts better and passes review)
Show value first; paywall after the first win. Clear price per period, trial length and what happens after it; a visible **Restore Purchases**; Terms (EULA) and Privacy links; a way to close. No fake countdowns, no pre-checked upsells, no hidden prices. Test locally with a StoreKit Configuration file (`.storekit`) wired into the scheme until store products exist.

## Localization
String Catalogs (`Localizable.xcstrings`), English source + Turkish. Turkish-specific: dotted/dotless i (`"i".uppercased(with: Locale(identifier: "tr"))` is "İ"), longer strings (~30%), date/number formats through `FormatStyle`, never string concatenation for sentences.

## Privacy & compliance in code
- `PrivacyInfo.xcprivacy` with collected data types and required-reason API entries (UserDefaults, file timestamps, disk space, system boot time) that match actual use.
- Purpose strings for every permission, asked in context, with a graceful path when denied.
- If accounts exist: in-app account deletion.
- `ITSAppUsesNonExemptEncryption = NO` in Info.plist unless you ship custom crypto.

## On-device AI (a privacy-first wedge)
On supported devices, Apple's Foundation Models framework gives an on-device language model with no API bill and no data leaving the phone:
```swift
import FoundationModels
if case .available = SystemLanguageModel.default.availability {
    let session = LanguageModelSession(instructions: "You summarize journal entries in one gentle sentence.")
    let reply = try await session.respond(to: entryText)
    summary = reply.content
}
```
Always provide a non-AI fallback; confirm current API details in the docs before shipping.

## Build & verify loop
`xcodegen generate` → build/test via MobileBuildMCP (`build_run_sim`, `test_sim`, `screenshot`, `snapshot_ui`) or `xcodebuild` → `bash .sedef/verify.sh quick` → acceptance flows for the phase. Fix warnings you introduce. Third-party skills worth loading when installed: `swiftui-expert-skill` (AvdLee), `swiftui-liquid-glass` (OpenAI).
