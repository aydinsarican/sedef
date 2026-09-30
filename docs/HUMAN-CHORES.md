# Human chores — what the factory cannot do for you

Nothing on this list is skipped, faked or scripted around. The factory turns each into a Telegram chore with exact values to paste and waits (other products keep moving). Close a chore with `/tamam <id>` (or tap the option buttons). When a chore asks you for a value — e.g. the ID of a new Chrome Web Store item — reply `/tamam <id> <value>`; the answer goes back to the product's next session.

## One-time (setup)
| Chore | Why a human | Time |
|---|---|---|
| Apple Developer organization enrollment, Agreements/Tax/Banking | legal identity and money | days of paperwork, once |
| App Store Connect team API key → `asc auth login` | account admin action | 5 min |
| Xcode sign-in for automatic signing | Apple ID with 2FA | 2 min |
| Google Play organization account, payments profile, service account | legal identity, money | once |
| Anthropic Console workspace, spend limit, API key | billing | 5 min |
| Telegram bot | your interface | 3 min |
| Payment provider onboarding (Paddle/Polar/iyzico) | KYC, payouts | once per provider |
| OAuth logins for Figma/Recraft/Expo/Vercel/Mobbin MCP (`claude mcp add …` + `claude mcp login …`, printed by the installer) | browser sign-in | 1 min each |

## Per product (batched, typically ~10–15 minutes)
| Chore | Store | Automatable later? | Time |
|---|---|---|---|
| Create the App Store Connect app record (values supplied) | Apple | yes, with `apple_web_session_automation` (unofficial endpoints) | 2–3 min |
| Publish the App Privacy label (answers supplied from the spec's data map) | Apple | yes, with web-session automation | 3 min |
| Trademark sanity check of the chosen name (TÜRKPATENT, EUIPO, USPTO) | all | no | 10 min |
| Create the Play app; fill App content (ads, audience, content rating, app access) | Google | no | 10 min |
| Closed test with 12 testers for 14 days | Google, personal accounts only | no — use an organization account | — |
| First Chrome Web Store item: listing + privacy tabs, then reply with the item ID | Chrome | no (updates are automated) | 10 min |
| A store status the factory can't read (no API/credentials): answer `yayinda` / `red` / `bekliyor` | any | add the store's credentials | 1 min |
| Product Hunt / Reddit / forum launch posts (text supplied) | — | no — communities require real people | 5–10 min |
| Domain purchase (if the product earns one) | — | policy-gated | 3 min |

## Occasional
| Chore | When |
|---|---|
| Paste an App Review rejection: `/red <slug> <text>` | a rejection, if web-session automation is off |
| Override a kill verdict on your own idea (`devam` / `oldur`) | the validation disagrees with you |
| Approve a first submission (`gonder` / `bekle`) | only if `first_submission_needs_human: true` |
| Apply a skill proposal: `/oneriler`, `/uygula <n>` | after the weekly retro |
| Apple Ads plan | a product earns paid acquisition (plan supplied) |
| Accountant questions (invoicing, withholding, entity) | revenue starts |

## Why not automate everything?
Stores require a responsible human for identity, money and legal commitments, and some steps have no API (app record creation, privacy label publishing, Play content forms). Community launches depend on real people. And a single "low-effort spam" strike can remove a developer account with every app on it — a short human glance at the batched list is cheap insurance.
