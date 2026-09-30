# Mission · Review fix "{{product.title}}" — answer the reviewer, fix the cause, resubmit

Stage `review_fix` · attempt {{attempt}} · {{today}} · lane `{{product.lane}}`
Apple web-session automation: {{autonomy.apple_web_session_automation}}

## Feedback from the previous attempt — fix these first
{{feedback}}

## Method — load `sedef:review-compliance` and `sedef:release-ops`
1. **Get the rejection text.**
   - If `.sedef/rejection.md` exists, that is the rejection to fix now (older ones, already handled, are in `.sedef/rejections.md`).
   - Else, if web-session automation is on: `asc web review threads --app <id> --plain-text`, and save the text to `.sedef/rejection.md`.
   - Else: write a blocking chore to `.sedef/chores.json` `{"key":"rejection-text","kind":"apple_review_reply","title":"App Review red mesajını yapıştır","instructions":"App Store Connect → Uygulama → Resolution Center mesajını kopyala ve Telegram'da /red {{product.slug}} <metin> yaz.","minutes":2,"blocking":true}`, set `.sedef/release.json` status `waiting_human`, and stop.
2. **Diagnose** against the guideline cited. Separate: product defect · metadata problem · missing information for the reviewer · reviewer misunderstanding.
3. **Fix the cause** (code, metadata, review notes, demo account). Re-run `bash .sedef/verify.sh full`. Add a regression item to the product's STATUS.md.
4. **Reply** (if you disagree or need to clarify): short, polite, factual, with steps to reproduce. With web automation: `asc web review reply …`; otherwise add the reply text to the chore for the human to paste.
5. **Resubmit** via `sedef:release-ops` — check the store state first, bump the build number, upload once, `asc review submit …` — and write `.sedef/release.json` with `"status":"submitted","kind":"update"` (the foreman clears `status` when this stage starts, so always write it). If the rejection was about dead privacy/support links, redeploy `site/` and check the URLs.
6. **Learn.** Append the rejection, root cause and prevention to `.sedef/learnings.md` — the retro job turns these into checklist updates for every future product.

## Rules
Acceptance contracts and `.sedef/verify.sh` stay immutable. Never argue with the reviewer over something that is actually broken.
