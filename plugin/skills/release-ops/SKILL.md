---
name: release-ops
description: Use in the factory's release, review-fix and release-watch stages — exact release procedures per lane (iOS with the asc CLI and xcodebuild, Android via EAS/Play, web via Vercel/Cloudflare, Chrome Web Store API v2, VS Code/Open VSX, Apify), the legal-site deploy every store submission needs, how to read review status per store, the human-chore format for steps no API allows, and the release.json contract.
---

# Release ops

**Principle:** automate everything the platforms allow; turn everything else into a precise, copy-paste chore for the human; never fake or script around a human-only step. Irreversible commands pass through the factory policy (submission caps, first-submission approval).

**Before anything else, look at the real state.** A previous session may have uploaded or submitted and then run out of turns. Check the store (`asc status …`, CWS `fetchStatus`, Play `releases`) and `.sedef/release.json` first; never upload the same build twice and never resubmit while a submission is in flight.

## Legal site — every store submission needs working URLs
The store stage writes `site/` (privacy policy, support page; terms if there's a paywall). Deploy it **before** metadata is applied, then use the real URLs:
```bash
# Cloudflare Pages (default; CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID are in env)
npx -y wrangler pages project create "$SEDEF_PRODUCT-legal" --production-branch main 2>/dev/null || true
npx -y wrangler pages deploy site --project-name "$SEDEF_PRODUCT-legal" --branch main --commit-dirty=true
# → prints https://<project>.pages.dev (a suffix is added if the name was taken — use what it prints)

# or Vercel
(cd site && vercel link --yes --project "$SEDEF_PRODUCT-legal" --token "$VERCEL_TOKEN" && vercel deploy --prod --yes --token "$VERCEL_TOKEN")
```
Replace the `legal-site.invalid` placeholder host in `metadata/` (and `listing/`) with the deployed host — privacy policy URL in app info, support/marketing URL per version localization — and check each one:
```bash
for u in "$PRIVACY_URL" "$SUPPORT_URL"; do curl -fsSIL -o /dev/null "$u" && echo "ok $u" || echo "DEAD $u"; done
```
A dead URL is a guaranteed rejection — fix it before submitting.

## iOS — `asc` (5.8+) + `xcodebuild`
Prereqs (human, once): `asc auth login --name factory …` stored in the keychain; Xcode signed in with the team's Apple ID for automatic signing. The agent never reads the `.p8` or keychain.

```bash
asc auth status --validate                                               # stop here if it fails → chore
asc status --app "$APP_ID" --include appstore,submission,review --output json   # what is already there?
asc apps list --bundle-id "$BUNDLE_ID" --output json                      # does the app record exist?
asc bundle-ids create --identifier "$BUNDLE_ID" --name "<App Name>" --platform IOS   # if missing
```
**App record** — the API cannot create it.
- If `apple_web_session_automation` is on: `asc web apps create --name "<App Name>" --bundle-id "$BUNDLE_ID" --sku "<SKU>" --primary-locale en-US --if-exists skip`
- Otherwise write a chore (kind `apple_app_record`) with exact values: name, bundle id, SKU, primary language; set release status `waiting_human`.

**Subscriptions** (or via the RevenueCat MCP, which can push products to the store):
```bash
asc subscriptions setup --app "$APP_ID" --group-reference-name "<Group>" --reference-name "<Pro Monthly>" \
  --product-id "$BUNDLE_ID.pro.monthly" --subscription-period ONE_MONTH --price 3.99 --price-territory USA --territories "USA,TUR"
```
Paid Apps agreement, tax and banking must already be done (human, once).

**Icon.** The factory copies `design/brand/icon-1024.png` into the app's `AppIcon.appiconset` when the brand stage passes. Check it is there and has no alpha (`sips -g hasAlpha …` → `no`) before archiving; an app without an icon is rejected at upload.

**Build and upload — once per build number**
```bash
xcodegen generate
xcodebuild -project "<App>.xcodeproj" -scheme "<App>" -configuration Release -destination 'generic/platform=iOS' \
  -archivePath build/App.xcarchive -allowProvisioningUpdates archive
xcodebuild -exportArchive -archivePath build/App.xcarchive -exportPath build/export \
  -exportOptionsPlist .sedef/ExportOptions.plist -allowProvisioningUpdates
asc publish testflight --app "$APP_ID" --ipa "build/export/<App>.ipa" --upload-only --wait --output json   # → .buildId
asc publish testflight --app "$APP_ID" --build-id "$BUILD_ID" --group "Internal Testers"             # optional, same build
```
`.sedef/ExportOptions.plist`: `method` = `app-store-connect`, `teamID`, `signingStyle` = `automatic`. Record `build_id` in release.json right away.

**Version, metadata, privacy, validation, submission** — `metadata/version/<ver>/` holds the version localizations, `metadata/` root the app info:
```bash
asc release stage --app "$APP_ID" --version "$VERSION" --build-id "$BUILD_ID" --metadata-dir "./metadata/version/$VERSION" --dry-run
asc release stage --app "$APP_ID" --version "$VERSION" --build-id "$BUILD_ID" --metadata-dir "./metadata/version/$VERSION" --confirm
asc metadata apply --app "$APP_ID" --version "$VERSION" --dir ./metadata --dry-run && \
asc metadata apply --app "$APP_ID" --version "$VERSION" --dir ./metadata
asc screenshots upload --app "$APP_ID" --version "$VERSION" --locale en-US --path ./screenshots/framed --device-type IPHONE_69 --replace --confirm
# privacy label — automation on:
#   asc web privacy plan --app "$APP_ID" --file metadata/privacy.json
#   asc web privacy apply --app "$APP_ID" --file metadata/privacy.json      # --confirm only together with --allow-deletes
#   asc web privacy publish --app "$APP_ID" --confirm
# automation off → chore (kind apple_privacy) with metadata/privacy.json summarized in Turkish
asc validate --app "$APP_ID" --version "$VERSION" --strict
asc review submit --app "$APP_ID" --version "$VERSION" --build-id "$BUILD_ID" --confirm
```
If the policy refuses the submission (30-day cap for new apps, or first-submission approval), stop — the foreman reschedules or asks the human. Updates and resubmissions of an app already in the store are not capped.

**Status (release_watch):** `asc status --app "$APP_ID" --include appstore,submission,review --output json` — one call, no `--watch`. Read `.appstore.state`, `.review.state`, `.submission.inFlight`:
| Seen | Means | `next` |
|---|---|---|
| `READY_FOR_DISTRIBUTION` / `READY_FOR_SALE` | live | `launch` (first release) or `grow` (update) |
| `REJECTED`, `METADATA_REJECTED`, `INVALID_BINARY`, or review `UNRESOLVED_ISSUES` | rejected | `review_fix` |
| `PENDING_DEVELOPER_RELEASE`, `WAITING_FOR_EXPORT_COMPLIANCE`, `PENDING_CONTRACT` | needs a human | `wait` + a chore |
| `WAITING_FOR_REVIEW`, `IN_REVIEW`, `PROCESSING_FOR_DISTRIBUTION`, `READY_FOR_REVIEW`, … | in progress | `wait` |

**Rejections (review_fix):** `.sedef/rejection.md` holds the rejection to fix now (the human pastes it with `/red <slug> …`; older ones are in `.sedef/rejections.md`). With automation on you may fetch it yourself: `asc web review threads --app "$APP_ID" --plain-text`, reply with `asc web review reply --thread-id <id> --message "…" --confirm`. If there is no `rejection.md` and automation is off, raise a blocking chore with key `rejection-text` and set status `waiting_human`.
**Reviews (grow):** `asc reviews list --app "$APP_ID" --stars 1,2,3 --sort -createdDate`, `asc reviews respond --review-id <id> --response "…"`.

Exit codes worth handling: 3 auth, 4 not found, 5 conflict, 6 read-only mode, 10–59 HTTP 4xx, 60–99 HTTP 5xx (retry later).

## Android — Expo/EAS or Gradle + Play Developer API
```bash
eas build --platform android --profile production --non-interactive
eas submit --platform android --latest --non-interactive     # eas.json submit profile: track "internal", serviceAccountKeyPath = the path in $GOOGLE_PLAY_SERVICE_ACCOUNT_JSON
```
**Status:** a token from the service account, then the track's releases (no edit session needed):
```bash
TOKEN=$(node "${CLAUDE_PLUGIN_ROOT}/skills/release-ops/scripts/play-token.mjs")
curl -fsS -H "Authorization: Bearer $TOKEN" \
  "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/$PACKAGE/tracks/production/releases" | jq '.releases[] | {releaseName, releaseLifecycleState}'
```
`RELEASE_LIFECYCLE_STATE_PUBLISHED` = live · `IN_REVIEW` / `DRAFT` = wait · `NOT_APPROVED` = rejected → review_fix · `NOT_SENT_FOR_REVIEW` / `APPROVED_NOT_PUBLISHED` = a human must act (chore).
Human-only (chores): create the Play app; complete App content (ads, audience, content rating, app access); personal accounts: recruit 12 testers for a 14-day closed test, then apply for production. Promotion to production counts against the submission cap.

## Web
```bash
vercel link --yes --project "$SEDEF_PRODUCT" --token "$VERCEL_TOKEN" && vercel deploy --prod --yes --token "$VERCEL_TOKEN"
# or: npx -y wrangler deploy   (Workers)  /  npx -y wrangler pages deploy dist --project-name "$SEDEF_PRODUCT" --branch main
```
Smoke-test the production URL (Playwright), including checkout in test mode. Custom domains and DNS are chores (policy escalates domain commands).

## Chrome Web Store (API v2)
```bash
TOKEN=$(curl -fsS https://oauth2.googleapis.com/token -d client_id="$CWS_CLIENT_ID" -d client_secret="$CWS_CLIENT_SECRET" \
  -d refresh_token="$CWS_REFRESH_TOKEN" -d grant_type=refresh_token | jq -r .access_token)
BASE="https://chromewebstore.googleapis.com"
curl -fsS -X POST -H "Authorization: Bearer $TOKEN" -T "dist/$SEDEF_PRODUCT.zip" "$BASE/upload/v2/publishers/$CWS_PUBLISHER_ID/items/$ITEM_ID:upload"   # → uploadState, crxVersion
curl -fsS -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"publishType":"DEFAULT_PUBLISH"}' \
  "$BASE/v2/publishers/$CWS_PUBLISHER_ID/items/$ITEM_ID:publish"                                                          # → state
curl -fsS -H "Authorization: Bearer $TOKEN" "$BASE/v2/publishers/$CWS_PUBLISHER_ID/items/$ITEM_ID:fetchStatus"            # status (release_watch)
```
Status: `submittedItemRevisionStatus.state` = `PENDING_REVIEW` → wait; `REJECTED` → review_fix; `publishedItemRevisionStatus.state` = `PUBLISHED` with nothing pending → live. Also watch `takenDown` / `warned`.
**New items:** the API cannot create one. Raise a blocking chore (key `cws-first-item`, no options) asking the human to create the item, fill the Store listing and Privacy tabs, enable 2-step verification, and **reply with the item ID**: `/tamam <id> <ITEM_ID>`. The answer arrives in `.sedef/chore-answers.json` (`choice`); store it as `app_id` in release.json.

## VS Code / Open VSX / Apify
`vsce publish --azure-credential` (personal access tokens stop working 1 Dec 2026) · `ovsx publish -p "$OVSX_TOKEN"` · `apify push`.

## Chores — how a human step is requested
`.sedef/chores.json` is an **outbox**: write the steps you need; after the session the foreman turns them into Telegram tasks and empties the file (history: `.sedef/chores-history.json`). The human's answers come back in `.sedef/chore-answers.json` (`key`, `choice`, `done_at`) — read it before asking again. Ask again only if the step is still undone.
```json
[{"key":"apple-app-record","kind":"apple_app_record","title":"App Store Connect'te uygulama kaydı aç","instructions":"Ad: Tide\nBundle ID: com.example.sedef.tide\nSKU: TIDE001\nBirincil dil: English (U.S.)","minutes":3,"blocking":true}]
```
Titles and instructions in Turkish, exact values included, ≤ 6 lines. `options` (e.g. `["gonder","bekle"]`) make it a choice; with no options the human may reply with one value (`/tamam <id> <value>`).

## `.sedef/release.json` (the foreman routes on `status`)
```json
{"status":"submitted|deployed|waiting_human","store":"apple|google|web|chrome","kind":"new|update","version":"1.0.0","app_id":"1234567890","build_id":"…","urls":{"privacy":"…","support":"…"},"notes":"…"}
```
The foreman blanks `status` when the stage starts, so write it every session. `submitted` → release_watch · `deployed` (web/extension live without review) → launch · `waiting_human` → the stage waits (a blocking chore wakes it).
Versioning: semver in `MARKETING_VERSION`; build number strictly increasing (`CURRENT_PROJECT_VERSION` = timestamp or increment); tag `v<version>` after submission.
