# Setup

Plan on about two hours the first time. Most of it is account paperwork that no API can do.

## 1. Host: a Mac that stays on
- A Mac mini (Apple silicon, 16 GB+; 24–32 GB if you want 3 parallel sessions with Xcode builds) on a UPS, with automatic login for the factory user so launchd agents run after reboots.
- **Create a dedicated standard (non-admin) macOS user** for the factory. It has its own keychain, its own Apple ID sign-in in Xcode, its own Claude Code config, and no access to your personal files. This is the real isolation boundary; the policy engine is defense in depth.
- Install Xcode (latest release) from the App Store as an admin, open it once, add the iOS simulator runtime, then as admin: `sudo xcodebuild -license accept`.
- Optional (Xcode 27): `sudo xcrun mcp-server enable --unsafe-always-allow-all-agents` lets agents use Apple's own Xcode MCP tools headlessly. Not required — MobileBuildMCP covers builds, tests and simulator control.

## 2. Accounts — keep the factory separate
| Account | Why separate | Notes |
|---|---|---|
| **Anthropic Console** workspace + API key | spend limit and usage you can see; doesn't eat anyone's personal Claude plan limits | set a monthly limit in the Console; `./install.sh --set-api-key` stores the key in the factory user's keychain |
| **Apple Developer Program — organization account** | App Review strikes (4.3 spam) apply per developer account; don't risk the account that hosts apps you already care about | needs a D-U-N-S number; complete Agreements, Tax and Banking once |
| **Google Play — organization account** | personal accounts need 12 testers × 14 days before every production launch | also needs D-U-N-S; create a service account with release permissions for the factory's apps |
| **GitHub** org or user | one private repo per product | `gh auth login` as the factory user; set `factory.github_owner` |
| **Telegram bot** | your only interface | @BotFather → `/newbot` → token; send the bot a message, then get your chat id and numeric user id (e.g. from `https://api.telegram.org/bot<TOKEN>/getUpdates`) |
| Payments for web/Mac lanes | Paddle (default) or Polar | Stripe does not onboard Turkish entities directly — see `plugin/skills/lanes/SKILL.md` |
| Optional: RevenueCat, fal.ai, Replicate, ElevenLabs, Google Stitch, Apify, Supabase, Vercel/Cloudflare, Figma, Recraft, Mobbin/Refero | extra capabilities per stage | a stage simply runs without a server whose key is missing |

Tax and legal structure (sole proprietorship vs company, invoicing, withholding on store income) are decisions for you and your accountant; the factory never makes them.

## 3. Install
A standard user can't install Homebrew packages, so the install has two parts:
```bash
# 1) from your admin account — shared tools for every user on this Mac
git clone https://github.com/aydinsarican/sedef.git /tmp/sedef && /tmp/sedef/install.sh --deps

# 2) as the factory user
git clone https://github.com/aydinsarican/sedef.git ~/sedef && cd ~/sedef
./install.sh --set-api-key --with-skills
```
(On a single admin account, plain `./install.sh …` does both.) Part 1 installs node, jq, gh, xcodegen, asc, uv, librsvg, imagemagick, xcbeautify, openjdk@17, cocoapods, Maestro, AXe and the Claude Code CLI. Part 2 checks them, installs Koubou (user-level), the CLI into `~/.local` if it's still missing, builds the runner, links `sedef` into Homebrew's bin or `~/.local/bin`, creates `~/.sedef/.env` from `.env.example`, stores the API key in the keychain, installs the recommended third-party skills, validates the plugin and config, and writes (but doesn't start) the launchd agent.

## 4. Configure
1. `~/.sedef/.env` — Telegram token/chat/user ids, `APPLE_TEAM_ID`, `ASC_VENDOR_NUMBER`, optional MCP and payment keys.
2. `config/sedef.config.yaml`:
   - `factory.support_email` — a real, monitored inbox (required before any store release; agents never invent contact details).
   - `factory.bundle_id_prefix`, `factory.github_owner`, `factory.locales`.
   - `lanes` — enable what you want. To build iOS products on your own starter, set `lanes.ios.template_repo` to your BaseApp repository; its files and CLAUDE.md rules are merged into each new iOS product.
   - `budgets_usd`, `concurrency`, `schedules`, `models`.
   - `autonomy` — keep `idea_gate: required` at first. Leave `apple_web_session_automation: false` until you trust the pipeline (see §6).
   - `critic` — enable with a provider and an exact model id you have access to for cross-vendor design critique.
3. App Store Connect API key (Admin creates a **team** key in App Store Connect → Users and Access → Integrations):
   ```bash
   mkdir -p ~/.asc && mv ~/Downloads/AuthKey_<ID>.p8 ~/.asc/ && chmod 600 ~/.asc/AuthKey_<ID>.p8
   asc auth login --name factory --key-id <ID> --issuer-id <ISSUER> --private-key ~/.asc/AuthKey_<ID>.p8 --network
   asc auth status --validate
   ```
4. Xcode → Settings → Accounts → sign in with the factory team's Apple ID (automatic signing for archives).
5. OAuth MCP servers you want (once each, as the factory user, at a terminal — a browser opens):
   ```bash
   claude mcp add --scope user --transport http figma https://mcp.figma.com/mcp && claude mcp login figma
   ```
   The installer prints the same line for each OAuth server in `config/mcp.json` (recraft, mobbin, expo, vercel, notion). Factory sessions pass the same name and URL, which is how Claude Code finds the stored login; if a stage log shows `needs-auth` for a server, log in again. Key-based servers need only their env var.
6. `sedef doctor` — fix every ❌; ⚠️ items are optional.

## 5. First run
```bash
./install.sh --start          # loads the launchd agent; the foreman restarts on crash and at login
tail -f factory/logs/foreman.log
```
On Telegram: `/durum`. Put in your own idea to see the whole path immediately: `/fikir Sörfçüler için çevrimdışı gelgit ve rüzgâr günlüğü`. Otherwise the scout posts cards at 08:30.

Watch the first product through spec and brand before letting several run in parallel. Read `STATUS.md` and `.sedef/` in its repo — everything the agents think is there.

## 6. Turning up autonomy later
- `apple_web_session_automation: true` + `asc web auth login --apple-id <factory Apple ID>` lets agents create app records, publish privacy labels and read/answer Resolution Center messages. These are unofficial App Store Connect web endpoints — they can change without notice; the Apple ID session needs 2FA renewal from time to time.
- `idea_gate: auto` with a high `idea_auto_threshold` lets top-scoring scout cards start without your tap.
- Raise `max_new_store_submissions_per_30d` only after a clean review history.

## 7. Updating
`git pull && (cd runner && npm ci && npm run build) && launchctl kickstart -k gui/$(id -u)/com.sedef.foreman`. Re-run `./install.sh` when dependencies change. When a new model generation arrives, change `config/sedef.config.yaml → models` and watch one product through the pipeline before trusting it.
