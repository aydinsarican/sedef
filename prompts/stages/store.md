# Mission · Store "{{product.title}}" — a listing that sells and passes review

Stage `store` · attempt {{attempt}} · {{today}} · lane `{{product.lane}}`
Locales: {{factory.locales}} (primary {{factory.primary_locale}}). Support e-mail: {{factory.support_email}}.
Apple account type: {{stores.apple.account_type}} · Google account type: {{stores.google.account_type}}.

## Feedback from the previous attempt — fix these first
{{feedback}}

## Method — load `sedef:store-listing`, `sedef:review-compliance`, and the `asc` / `app-store-screenshots` / Remotion skills if installed
1. **ASO.** Keyword research for the segment (web search and the `sedef_data` iTunes Search API; web pages only from documentation domains), then per locale: name (30), subtitle (30), keywords (100 chars, comma-separated, no spaces, no repeats of name words, no competitor trademarks), promotional text, description (the first three lines carry it), what's new.
2. **Metadata files** in the `asc` layout (note: `metadata/version/<ver>/`, not `versions/`): `metadata/app-info/<locale>.json` and `metadata/version/1.0.0/<locale>.json`. Web/extension lanes: the store-listing equivalent under `listing/`.
3. **Screenshots** from the real app (simulator capture), story-first: the first three frames sell the wedge; captions ≤ 6 words, localized. Required iPhone size 6.9" (1320×2868) at minimum; iPad sizes only if the app supports iPad. Frame and caption them in the product's own direction — not a generic template.
4. **App Preview (optional but recommended).** 15–30 s, built only from real screen recordings of the app (guideline 2.3.4) — Remotion or ffmpeg over `xcrun simctl io booted recordVideo` captures, with licensed music/voice.
5. **Legal & support pages.** Privacy policy (from the spec's data map), terms/EULA (Apple standard EULA is acceptable for iOS), support page — as a tiny static site in `site/` (`privacy.html`, `support.html`, `terms.html` if there's a paywall) that the release stage deploys and wires into the metadata. Use placeholders like `https://legal-site.invalid/privacy.html` in metadata; the release stage replaces them with the deployed URLs. Real contact details only: the support e-mail above. If it is not configured, write a blocking chore — never invent contact details.
6. **Monetization products.** Define IAP/subscription products (ids, periods, prices, localized display names) in `.sedef/store-plan.md`; create them through the RevenueCat MCP or `asc subscriptions …` when credentials allow, otherwise as chores.
7. **Privacy label & review info.** Map the data map to Apple's privacy categories → `metadata/privacy.json` (asc web privacy format). Review notes: how to reach every feature, demo account if login exists, AI disclosure.
8. **Compliance gate.** A `sedef:compliance-reviewer` subagent audits app + listing against `sedef:review-compliance`. Write `.sedef/compliance.json` = `{"pass": true|false, "findings":[{"guideline":"…","severity":"blocker|major|minor","fix":"…"}]}`. Fix blockers before finishing; `pass` must be true.

## Output contract
`.sedef/store-plan.md` · `.sedef/compliance.json` (pass: true) · metadata/listing files · screenshots · `site/` legal pages · `bash .sedef/verify.sh store` passes.

## Rules
No fake reviews, testimonials, user counts or awards. No competitor names in keywords. Paraphrase research; don't paste.
