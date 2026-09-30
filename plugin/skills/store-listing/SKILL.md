---
name: store-listing
description: Use when preparing a store listing in the factory — ASO rules and limits, asc metadata file layout, screenshot capture/frame/upload with asc (or the app-store-screenshots skill), App Preview rules, the privacy label file, legal/support pages and App Review notes.
---

# Store listing

A listing has two jobs: convert a skimmer in three seconds, and survive App Review on the first try. Both reward the same thing — truth, specificity, and the wedge up front.

## ASO (Apple limits)
- **Name** ≤ 30, **subtitle** ≤ 30, **keywords** ≤ 100 characters: comma-separated, no spaces after commas, no words already in name/subtitle, singulars, no duplicates, no competitor or trademarked names, no "app"/"free".
- **Promotional text** ≤ 170 (editable without review) · **description** ≤ 4,000 (first three lines are what people see) · **what's new** per version.
- Research in the storefront's language with what the segment actually types; Turkish keywords are not translations of English ones.
- Every storefront gets its own keyword set; do localization by a native-quality `sedef:store-producer` per locale.

## asc metadata layout (verified: the folder is `version/`, not `versions/`)
```
metadata/
  app-info/en-US.json          {"name":"…","subtitle":"…","privacyPolicyUrl":"https://…","privacyChoicesUrl":"","privacyPolicyText":""}
  app-info/tr.json
  version/1.0.0/en-US.json     {"description":"…","keywords":"…","marketingUrl":"https://…","promotionalText":"…","supportUrl":"https://…","whatsNew":"…"}
  version/1.0.0/tr.json
  privacy.json                 (see below)
```
```bash
asc metadata validate --dir ./metadata
asc metadata apply --app "$APP_ID" --version 1.0.0 --dir ./metadata --dry-run   # then without --dry-run (release stage)
```
Categories, age rating and review info are not part of `metadata apply`; set them with the matching `asc` commands or list them for the release stage.

## Screenshots
Story order: **promise → proof → delight → trust**. The first three frames sell the wedge; captions ≤ 6 words; real UI only (no mockups that misrepresent); localized captions and in-app content. iPhone 6.9" (1320 × 2868 portrait) is the required set; add iPad 13" only if the app supports iPad.

Capture from the real app with `asc` (plan format verified against the binary):
```json
{"version":1,"app":{"bundle_id":"<bundle-id>","output_dir":"./screenshots/raw"},
 "steps":[{"action":"launch"},{"action":"wait_for","id":"core.list","timeout_ms":5000},{"action":"screenshot","name":"01-core"},
          {"action":"tap","id":"core.add"},{"action":"screenshot","name":"02-add"}]}
```
```bash
asc screenshots run --plan .asc/screenshots.json
asc screenshots matrix --plan .asc/screenshots-matrix.json --max-concurrency 2   # devices × locales × appearances
asc screenshots frame --input-dir ./screenshots/raw --output-dir ./screenshots/framed --device iphone-17-pro-max --title "…" --resume
asc screenshots upload --app "$APP_ID" --version 1.0.0 --locale en-US --path ./screenshots/framed --device-type IPHONE_69 --replace --confirm
```
Matrix file: `{"version":1,"base_plan":"screenshots.json","devices":[{"id":"iphone-17-pro-max","udid":"<udid>"}],"locales":["en-US","tr-TR"],"appearances":["light","dark"],"content_variants":[{"id":"default"}]}` (simulators booted first). Framing needs Koubou (`asc screenshots frame` expects the version asc was built against; if framing fails, upload the raw captures — they pass the store check — or frame with the `app-store-screenshots` skill); capture needs AXe. Frame and caption in the product's own direction — a generic template frame undoes the brand work. The `app-store-screenshots` skill (a small Next.js editor that exports every store size) is a good alternative for custom layouts.

Seed realistic demo content (never real personal data, never fake reviews or user counts). Status bar: 9:41, full battery.

## App Preview (optional, recommended)
15–30 s, 886 × 1920 for the 6.9" set. **Only real screen captures of the app** (guideline 2.3.4) — record with `xcrun simctl io <udid> recordVideo`, then cut, caption and score with Remotion (or ffmpeg). Generated footage is fine in ads, never in the preview. Music/voice must be licensed for commercial use.

## Privacy label — `metadata/privacy.json` (asc web privacy format)
```json
{"schemaVersion":1,"dataUsages":[
  {"category":"EMAIL_ADDRESS","purposes":["APP_FUNCTIONALITY"],"dataProtections":["DATA_LINKED_TO_YOU"]},
  {"category":"PRODUCT_INTERACTION","purposes":["ANALYTICS"],"dataProtections":["DATA_NOT_LINKED_TO_YOU"]}
]}
```
or `{"schemaVersion":1,"dataUsages":[{"dataProtections":["DATA_NOT_COLLECTED"]}]}`. Derive it from the spec's data map and the SDKs actually linked (RevenueCat, TelemetryDeck, crash reporting). The API can't publish it; the release stage uses `asc web privacy apply/publish` when automation is on, otherwise it's a chore with this file attached.

## Legal & support pages (`site/`)
Privacy policy (from the data map, plain language), Terms of Use / EULA (Apple's standard EULA is acceptable — link it in-app and in the description for subscriptions), support page with the configured support e-mail. Never invent a phone number, address or company name; if something is missing, it's a chore.
Files: `site/privacy.html`, `site/support.html` (and `site/terms.html` with a paywall) — plain static HTML in the product's own type and colors. In metadata, write `https://legal-site.invalid/privacy.html` placeholders (a reserved, never-resolving host); the release stage deploys `site/`, swaps in the real host and checks every URL answers 200 before anything is submitted.

## Review notes
How to reach every feature in under two minutes; demo account if anything is behind login; which features use AI and how consent works; anything unusual (background modes, permissions) and why; the real support contact.
