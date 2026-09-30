---
name: lanes
description: Use when choosing or working in a revenue lane (iOS, iOS+Android via Expo, web SaaS, Chrome extension, Mac direct, Apify actor, Figma plugin, digital assets) — what each lane is good for, how it gets paid, what can be automated, what stays a human chore, and which payment rails work for a Turkey-based seller.
---

# Lanes — where products live and how they get paid

Facts below were checked in late September 2026. Store terms change; when a number drives a decision, re-check the linked source through a docs fetch.

## Choosing a lane
Pick the lane that maximizes **(reach × monetization) ÷ build risk** for *this* segment:
- Buyers search app stores on their phones, the value is daily and personal → **iOS** (our strongest craft).
- The segment is split across iPhone and Android and the UI is standard → **Expo (iOS + Android)**.
- Work happens at a desk, teams buy, value is in data/workflows → **web SaaS**.
- The pain lives inside websites people already use → **Chrome extension**.
- Developers/creators, utilities, menu-bar tools → **Mac direct** (Paddle) or Setapp.
- Data/automation that other businesses (and AI agents) pay per use → **Apify actor**.
- Designers' repetitive work → **Figma plugin** (manual publishing; experiment lane).
- Templates, kits, packs → **digital assets** (Gumroad).

## Lane sheet

| Lane | Stack | Publish path & automation | Human chores | Money |
|---|---|---|---|---|
| **ios** | SwiftUI, Swift 6, SwiftData, RevenueCat, XcodeGen (BaseApp conventions) | `asc` CLI + App Store Connect API: bundle ids, IAP/subscriptions, metadata, screenshots, build upload, TestFlight, validate, submit, review replies, analytics | create the app record, publish the privacy label, read Resolution Center (all three can be automated with `asc web` — unofficial endpoints, opt-in) | IAP/subscriptions; Apple pays Turkish bank accounts; Small Business Program 15% under $1M/yr |
| **expo_dual** | Expo SDK, Expo Router, Reanimated, react-native-purchases | EAS Build/Submit non-interactive after first setup; Play Developer API for tracks, listings, IAP, review replies | Play: create the app, content forms (ads, audience, rating), and for **personal** accounts 12 testers × 14 days of closed testing before production; Apple chores as above | Play payouts in TRY to Turkish accounts; fee terms are changing region by region in 2026–27 — check before pricing |
| **web_saas** | Next.js/Astro, Tailwind from DESIGN.md, Supabase | `vercel deploy --prod` / `wrangler deploy` — fully automatable | buy a domain (or ship on a subdomain), payment-provider onboarding and payout details | via a merchant of record (below) |
| **chrome_extension** | MV3, TypeScript, minimal permissions | Chrome Web Store API v2 for uploads/publishing of existing items (V1 API shuts down 15 Oct 2026) | the very first item, store listing & privacy tabs, 2-step verification | no built-in payments (removed 2021): own checkout + license keys; affiliate links need disclosure and user value (2025 policy); stricter data-collection limits since 1 Aug 2026 |
| **mac_direct** | SwiftUI for macOS, Sparkle updates, notarization | notarize + ship DMG; Mac App Store optional | Developer ID certificate setup | Paddle checkout + licenses; Setapp pays ~70% of its subscription pool by usage |
| **apify_actor** | TypeScript/Python actor, Apify SDK | `apify push`; actors are callable by AI agents over Apify's MCP | account + payout details | rental, per-result or per-event pricing; Apify keeps 20% (of profit after platform cost for per-result/per-event); payouts from $100 by wire |
| **figma_plugin** | TypeScript plugin API | desktop-app upload only, manual review, 2FA | the whole publish step | Figma takes 15%; paid availability for new sellers is inconsistent — treat as experiment |
| **digital_assets** | generated/designed packs, templates | Gumroad API for products; Notion/Framer marketplaces manual | seller verification (Notion can take months) | Gumroad 10% + $0.50, pays Turkish banks in TRY; Notion 8% + $0.40; Framer 0% |

**Distribution, not revenue:** Claude's plugin directory (submissions opened late Sep 2026) and the ChatGPT app directory don't let you sell digital goods inside them — treat them as top-of-funnel for your own product. Telegram Mini Apps get paid in Stars → TON → exchange with KYC: possible, awkward. **Avoid:** RapidAPI (PayPal-only payouts — unusable from Turkey), Lemon Squeezy (migrating users to Stripe Managed Payments; don't start new products on it), programmatic-SEO sites (Google spam updates ran repeatedly through 2026).

## Payment rails for a Turkey-based seller (late Sep 2026)

| Rail | Works from Turkey? | Notes |
|---|---|---|
| Apple App Store / Google Play | ✅ | pay out to Turkish bank accounts |
| **Paddle** (merchant of record) | ✅ | onboards software sellers outside its sanctions list (Turkey is not on it); 5% + $0.50; monthly payout by SWIFT wire or Payoneer, $100 minimum. Default for web/Mac. |
| **Polar.sh** (MoR) | ⚠️ likely | Turkey is on its payout list via Stripe Connect Express; 5% + $0.50 (+1.5% non-US cards) + payout fees. Do one real test payout before relying on it. |
| **Gumroad** | ✅ | pays Turkish bank accounts in TRY, $100 minimum |
| **iyzico** | ✅ domestic | Turkish cards/customers; the team's existing iyzico payments module fits here; needs a company or sole-proprietor registration (except pay-by-link) |
| Stripe | ❌ direct | no Turkish entities; Stripe Atlas (US company, ~$500 + $100/yr) is the workaround, with US tax/bank overhead — a human decision |
| Lemon Squeezy | ❌ for new products | see above |
| PayPal | ❌ | left Turkey in 2016 |
| Wise | ❌ receiving | Turkish residents can't receive or hold balances since 2023 |
| Payoneer | ✅ | usable for receiving and as a Paddle payout route |

**Tax:** app-store income in Turkey has specific withholding and export-deduction rules that changed recently; anything about entity type, invoicing or deductions is a **human chore for the accountant (mali müşavir)** — agents never decide it.

## Automation reality (all lanes)
No store lets an agent go from zero to a live listing with no human at all. Everything after the first human setup is automatable: builds, uploads, metadata, screenshots, pricing, submissions, review replies, analytics. The factory batches the human-only steps into a short weekly list instead of asking every time.
