# Mission · Release "{{product.title}}" — ship it through the right door

Stage `release` · attempt {{attempt}} · {{today}} · lane `{{product.lane}}`
Submissions so far for this product: {{product.submissions}} · store app ids: {{product.app_ids}}
Apple web-session automation: {{autonomy.apple_web_session_automation}} · max new submissions per 30 days: {{autonomy.max_new_store_submissions_per_30d}}

## Feedback from the previous attempt — fix these first
{{feedback}}

## Method — load `sedef:release-ops` (and the `asc` skills if installed)
**First, the real state:** `.sedef/release.json`, `.sedef/chore-answers.json`, and the store itself (`asc status …` / CWS `fetchStatus` / Play `releases`). A previous session may already have uploaded or submitted — never upload the same build twice, never resubmit while a submission is in flight.

Then follow the lane's release path in the skill. In short:

- **Legal site first (every store lane):** deploy `site/` (Cloudflare Pages or Vercel), put the real privacy/support URLs into the metadata, and check each with `curl -fsSIL`. Dead links are a guaranteed rejection.
- **iOS (asc):** `asc auth status --validate` → bundle id → app record (web session if enabled, otherwise a chore with exact values) → icon present, no alpha → archive + export IPA → upload **once**: `asc publish testflight … --upload-only --wait --output json` (keep `buildId`) → `asc release stage … --build-id … --metadata-dir ./metadata/version/<ver> --confirm` (dry run first) → `asc metadata apply --dir ./metadata` → screenshots upload → privacy label (web session or chore) → `asc validate --strict` → `asc review submit … --build-id … --confirm`.
- **Android (Expo/EAS or Gradle):** build AAB → internal track via service account. A brand-new Play app needs the human to create it and fill the content forms; personal accounts need 12 testers × 14 days before production — chores, not workarounds.
- **Web SaaS:** `vercel link --yes --project <slug>` + `vercel deploy --prod --yes` (or wrangler); wire the payment rail from the spec in test mode first, then live keys if present; smoke-test checkout.
- **Chrome extension:** zip → Chrome Web Store API v2 upload + publish for an existing item (item id from release.json or `.sedef/chore-answers.json`); the very first item is a chore that returns the item id.

## Human-only steps
Never fake, script around, or skip them. Write each to `.sedef/chores.json` (a JSON array — an outbox the foreman empties after the session) as
`{"key":"…","kind":"apple_app_record|apple_privacy|play_app_create|play_content_forms|play_closed_test|cws_first_item|account|payment|other","title":"<Turkish, short>","instructions":"<Turkish, exact values to paste, ≤ 6 lines>","minutes":N,"blocking":true}`
and set release status to `waiting_human`. The human's answers come back in `.sedef/chore-answers.json`; check it before asking again. The stage runs again when a blocking chore is closed.

## Output contract — `.sedef/release.json`
```json
{"status":"submitted|deployed|waiting_human","store":"apple|google|web|chrome","kind":"new|update","version":"1.0.0","app_id":"…","build_id":"…","urls":{"privacy":"…","support":"…"},"notes":"…"}
```
`submitted` = in review; `deployed` = live without review (web); `waiting_human` = blocked on chores. The foreman clears `status` when this stage starts — write it before you finish, every time. A session that ends early (turn or budget limit) never counts as a pass.

## Rules
- If a submission is refused by policy (30-day cap or first-submission approval), stop trying: record `waiting_human` or leave status as is and explain in `.sedef/notes.md`. The foreman reschedules.
- Never read or print credentials. Tools read them from the keychain or env.
- Real contact details only (support e-mail {{factory.support_email}}).
