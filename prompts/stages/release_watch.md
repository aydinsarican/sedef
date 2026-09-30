# Mission · Release watch "{{product.slug}}" — one cheap status check

Stage `release_watch` · {{today}} · lane `{{product.lane}}` · launched: {{product.launched_at}}
Read `.sedef/release.json` for the store, version and app id.

## Do exactly this
1. Query the store status once (exact commands and state tables: `sedef:release-ops`):
   - Apple: `asc status --app <app_id> --include appstore,submission,review --output json` (no `--watch`) — read `.appstore.state` and `.review.state`.
   - Chrome: OAuth token from the `CWS_*` env, then `GET …/v2/publishers/$CWS_PUBLISHER_ID/items/<item_id>:fetchStatus`.
   - Google Play: `node "{{paths.plugin}}/skills/release-ops/scripts/play-token.mjs"` for a token, then `GET …/applications/<package>/tracks/production/releases` → `releaseLifecycleState`.
2. Map it to `next`:
   - live (`READY_FOR_DISTRIBUTION`/`READY_FOR_SALE`, CWS `PUBLISHED` with nothing pending, Play `…_PUBLISHED`) → `launch` if this product has never launched (launched: "not launched"), otherwise `grow`
   - rejected (`REJECTED`, `METADATA_REJECTED`, `INVALID_BINARY`, review `UNRESOLVED_ISSUES`, CWS `REJECTED`, Play `…_NOT_APPROVED`) → `review_fix`
   - a human must act (`PENDING_DEVELOPER_RELEASE`, `WAITING_FOR_EXPORT_COMPLIANCE`, `PENDING_CONTRACT`, Play `…_NOT_SENT_FOR_REVIEW` / `…_APPROVED_NOT_PUBLISHED`) → `wait`, plus one chore in `.sedef/chores.json` saying exactly what to click (key `store-action-<state>`)
   - anything else (waiting, in review, processing) → `wait`
3. Write `.sedef/review-status.json`:
   `{"checked_at":"<ISO>","store":"…","raw_state":"<store's state string>","next":"launch|grow|review_fix|wait"}`

Nothing else: no code changes, no retries on errors — if the query fails, set `next` to `wait` and put the error in `raw_state`. If you have no way to query this store (no credentials, no API), set `wait` and add one chore (key `store-status-<store>`) asking the human to check and answer with `/tamam <id> yayinda|red|bekliyor` (options `["yayinda","red","bekliyor"]`, actions `{"yayinda":{"goto":"launch"},"red":{"goto":"review_fix"}}` — use `grow` instead of `launch` if the product already launched).
