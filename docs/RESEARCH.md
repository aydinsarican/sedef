# Research notes — autonomous product factories (as of 30 Sep 2026)

Condensed from a multi-source review done while designing Sedef. Star counts come from a GitHub mirror and are indicative only; revenue figures from third parties are flagged. Paraphrased throughout — follow the sources for detail.

## 1. What the setups that actually ship have in common
1. **A fresh context for every unit of work**, with state in files, git or an issue graph — the "Ralph loop" idea (re-run the same prompt in a new session; progress lives in the repo) became the default mental model. Anthropic's own successor is `/goal`, where a separate fast model checks a completion condition after each turn.
2. **Atomic claiming from a task graph** rather than peers negotiating locks — Cursor's research found lock-based peers stalled (20 agents ≈ throughput of 2–3), while planners + non-coordinating workers + a judge scaled.
3. **A coordinator that doesn't code, workers, and an independent judge.** Lenient self-grading is the most reported failure.
4. **Verifiers the agents can't edit.** Anthropic's C-compiler experiment (16 agents, ~2,000 sessions) concluded the task verifier must be nearly perfect; a reference oracle let agents split a huge task.
5. **Iteration caps, budgets and a way to give up** — runaway cost and non-convergence are the other big failure modes (Steve Yegge described Gas Town as effectively burned down because agents never converged).
6. **Containment instead of approval prompts.** Users approve the vast majority of prompts anyway; the safer design is sandboxing, credentials outside the agent's reach and restricted egress. Anthropic's Managed Agents post describes a stateless orchestrator, the sandbox as a tool, a durable event log, and credentials that never enter the sandbox.
7. **Harness assumptions go stale** with each model generation — delete scaffolding you no longer need.

## 2. Systems people use (late Sep 2026)
| System | Core idea worth taking | Signal | Caveat |
|---|---|---|---|
| Ralph loop / Anthropic `ralph-loop` plugin | fresh-context loop; tests push back | widely adopted; cited by Anthropic | only as good as its verifier |
| Anthropic harness posts (Nov 2025, Mar 2026) | initializer + coding agent, feature list JSON where agents may only flip `passes`, progress file; later planner/generator/evaluator with "sprint contracts" | primary source | richer harness cost ~$200 vs ~$9 for a solo run on the same app |
| Claude Code (routines, `/goal`, auto permission mode, agent teams — experimental) | native scheduling and completion checks | vendor | agent teams: no resume, experimental |
| Claude Agent SDK / Managed Agents (beta) | programmatic sessions with hooks, budgets, custom permission callbacks / hosted sandboxes | vendor | Managed Agents in beta |
| Beads (Yegge) | git-backed issue graph with dependencies and atomic claiming | ~27k★, active | take Beads, skip Gas Town |
| Paperclip | org charts, heartbeats, budgets that auto-pause, board approvals for agents | ~94k★ | every heartbeat is an LLM call; outcomes unverified |
| OpenClaw (+ Hermes Agent, NanoClaw) | always-on personal agents with skills hubs | very large following | 341 malicious skills found on its hub in Feb 2026, a privilege-escalation CVE, many exposed instances |
| Superpowers, OpenSpec, Spec Kit, BMAD, Compound Engineering | brainstorm → spec/plan → TDD with review; compounding learnings | Superpowers ~293k★; OpenSpec highest npm use | GSD archived; Taskmaster stale |
| Cursor Projects, OpenAI Symphony, Factory Missions, Codex cloud | coordinators over many isolated runs; proof-of-work before landing | vendor launches Aug–Sep 2026 | trusted environments; token-hungry |

## 3. Reality check: "AI runs a company"
- No verifiable case of an unattended pipeline that keeps shipping profitable products was found.
- Polsia (one founder, $30M raised) — its revenue is what users pay Polsia; the founder said on a podcast that about 10% of its companies ever earned a dollar (third-party figures are lower still).
- NanoCorp's own dashboard showed all its businesses together earning about $1.5k in 30 days.
- The CRUX #1 evaluation: an OpenClaw agent built and submitted an iOS app in ~45 minutes for ~$25 of model spend, but the whole run cost ~$1,000 (mostly waiting on a 10-day review), needed 5 human interventions, and the agent fabricated a contact phone number.
- Anthropic's Project Vend: phase 1 lost money (below-cost sales, hallucinated payment details, talked into discounts); phase 2 mostly stopped the losses with procedures and checklists ("bureaucracy matters"), yet its CEO agent still approved concessions far more often than it refused them.
- Andon Market (a shop run by an agent) reports it is not profitable; AI Village agents fabricated contacts and partnerships.
- **Lesson:** getting customers is the bottleneck, not building. Keep humans on money, legal identity and store submissions; keep state outside the model; budget everything; ship fewer, clearly different products.

## 4. Building & publishing: what is automatable
| Step | Automatable? | How |
|---|---|---|
| Build/test/run iOS headlessly | yes | MobileBuildMCP (Sentry, formerly XcodeBuildMCP; v2.7.1, Sep 2026), Xcode 26.3+ `xcrun mcpbridge`, Xcode 27 MCP (preview headless mode), Maestro (+ `maestro mcp`) |
| ASC: bundle ids, IAP/subscriptions, metadata, screenshots, build upload, TestFlight, submit, reply to reviews, analytics | yes | App Store Connect API via the `asc` CLI (Homebrew core, 5.8.0) and its 25 agent skills |
| ASC: create the app record · publish privacy label · read Resolution Center | **no API** | `asc web …` uses unofficial web endpoints (Apple ID session) — or a human |
| Google Play: upload, tracks, listings, IAP, data safety, review replies | yes | Play Developer API / EAS Submit |
| Google Play: create app, App content forms; personal accounts' 12 testers × 14 days | **no** | human; organization accounts are exempt from the closed-test rule |
| Web deploys | yes | `vercel deploy --prod`, `wrangler deploy` |
| Chrome Web Store updates | yes (API v2; V1 ends 15 Oct 2026) | first item is manual |
| Figma Community publishing | no | desktop app, 2FA, manual review |
| Monetization setup | yes | RevenueCat MCP (products, entitlements, offerings, AI paywalls, push to stores), Superwall MCP, Adapty CLI |

**Policy pressure:** Apple's June 2026 guideline update tightened 4.3(b) — saturated categories need a meaningful difference, apps that aren't improved or don't attract customers can be removed, and repeated low-effort submissions can lead to removal from the Developer Program. 4.2.6 rejects template/app-generator apps not submitted by the content owner; 5.1.2(i) requires explicit consent before personal data goes to third-party AI. Submissions surged in early 2026 and review queues briefly stretched to weeks.

## 5. Making agent output distinctive
- **Skills:** `frontend-design` (most installed design skill; bans named clichés, requires a plan and a self-review), `impeccable` (deterministic anti-pattern detector for CI), `taste-skill` (variance/motion/density dials), `ui-ux-pro-max` (styles, palettes, font pairs). Popular skills become the new sameness — use them as menus.
- **Design MCPs:** Figma (write to canvas via `use_figma`, design-system search, shaders; Weave model runs need per-run cost approval), Google Stitch (fast screen variants), Mobbin/Refero (references — they pull toward popular apps), Rive/Lottie/Spline/Blender MCPs for motion and 3D.
- **Formats:** Google's DESIGN.md (April 2026) — YAML tokens + rationale, with `lint`/`diff`/`export`.
- **Models:** Nano Banana family, GPT Image 2.5, Recraft (true SVG, custom styles), Ideogram (typography), Veo/Kling/Runway for video (Sora 2's API shut down in Sep 2026), ElevenLabs for voice/SFX/music, fal/Replicate as aggregators.
- **Anti-sameness research:** *Verbalized Sampling* (Zhang et al., ICML 2026) — asking for several responses with probabilities and sampling the tail restores diversity without training. *Artificial Hivemind* (NeurIPS 2025 best paper) — models converge on each other and LLM judges share blind spots, so ensembles alone don't fix sameness; judge on fit and distance, not "best".
- **iOS:** Liquid Glass makes system chrome look alike across apps (iOS 27 adds a clear↔tinted slider), so differentiation moves to type, color, illustration, icon and motion.
- **Legal:** purely AI-generated images may not be copyrightable in the US; App Store 2.3.9 requires rights to all assets; App Previews must be real screen captures (2.3.4).

## 6. Revenue lanes and payment rails for a Turkey-based seller
- **Best fits:** web micro-SaaS and directly sold Mac apps via a merchant of record (Paddle; Polar after a test payout), Apify actors (usage-based, Apify keeps 20%), clearly differentiated iOS/Android apps; cheap experiments: Figma plugins, Notion templates, Gumroad packs.
- **Distribution-only:** Claude plugin directory (submissions opened late Sep 2026) and ChatGPT apps (no digital-goods sales).
- **Avoid:** RapidAPI (PayPal-only payouts), Lemon Squeezy (migrating users to Stripe Managed Payments), programmatic-SEO content farms (repeated Google spam updates in 2026).
- **Rails:** Stripe doesn't onboard Turkish entities (Stripe Atlas is the workaround); Paddle works (5% + $0.50, SWIFT/Payoneer payouts); Polar lists Turkey via Stripe Connect Express; Gumroad pays Turkish banks in TRY; PayPal left Turkey in 2016; Wise can't receive for Turkish residents; iyzico for domestic; Apple and Google pay Turkish accounts. Tax treatment of app-store income changed recently — an accountant's call.

## 7. How the findings shaped Sedef
| Finding | Design decision |
|---|---|
| Fresh context beats long sessions | one session per stage; one build phase per session; state in files/git |
| Lenient self-grading | independent `evaluator` is the only writer of the scoreboard; foreman requires measurable progress |
| Verifier must be near-perfect and untouchable | contracts written in spec, immutable in build (policy + shell rules + snapshot/restore), stop gate |
| Runaway cost / non-convergence | per-session/day/month/product budgets, attempts, re-plan limits, park |
| Approval prompts don't add safety | policy engine answers prompts; dedicated macOS user; secrets out of the agent's env; escalations batch human-only steps |
| Prompt injection via web content and skills | capability separation per stage; `sedef_data` instead of a shell for research; agents can't write skills/settings/.mcp.json; skill changes only via human-applied proposals |
| Getting customers is the bottleneck | validation demands a first-100-users plan; launch/grow/portfolio stages; kill freely |
| Apple 4.3(b) and repeated-submission risk | rolling submission cap, novelty ledger, compliance audit before every submission, separate organization account |
| Models converge on the same taste | seeded constraint-deck draws, Verbalized Sampling, DESIGN.md, distance-based novelty check, optional cross-vendor critic |
| Store steps without APIs | explicit chores with exact values; optional `asc web` automation |

## Sources
- Anthropic engineering: [effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) · [harness design for long-running apps](https://www.anthropic.com/engineering/harness-design-long-running-apps) · [building a C compiler with agent teams](https://www.anthropic.com/engineering/building-c-compiler) · [Managed Agents](https://www.anthropic.com/engineering/managed-agents)
- Claude Code docs: [headless](https://code.claude.com/docs/en/headless.md) · [hooks](https://code.claude.com/docs/en/hooks.md) · [plugins reference](https://code.claude.com/docs/en/plugins-reference.md) · [Agent SDK (TypeScript)](https://code.claude.com/docs/en/agent-sdk/typescript.md) · [agent teams](https://code.claude.com/docs/en/agent-teams.md) · [/goal](https://code.claude.com/docs/en/goal)
- Loops & orchestrators: [Ralph (Huntley)](https://ghuntley.com/loop/) · [ralph-loop plugin](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/ralph-loop) · [Beads](https://github.com/gastownhall/beads) · [Cursor: scaling agents](https://cursor.com/blog/scaling-agents) · [OpenAI Symphony](https://github.com/openai/symphony) · [Paperclip](https://github.com/paperclipai/paperclip) · [OpenClaw](https://github.com/openclaw/openclaw) · [ClawHub malicious skills (The Hacker News)](https://thehackernews.com/2026/02/researchers-find-341-malicious-clawhub.html)
- Methodology packs: [Superpowers](https://github.com/obra/superpowers) · [OpenSpec](https://github.com/Fission-AI/OpenSpec) · [Spec Kit](https://github.com/github/spec-kit) · [BMAD](https://github.com/bmad-code-org/BMAD-METHOD) · [Compound Engineering](https://github.com/EveryInc/compound-engineering-plugin)
- Reality check: [Project Vend 1](https://www.anthropic.com/research/project-vend-1) · [Project Vend 2](https://www.anthropic.com/research/project-vend-2) · [CRUX #1](https://cruxevals.com/crux/autonomous-ai-ios-development/) · [Polsia founder interview (Mixergy)](https://mixergy.com/interviews/is-polsia-a-250m-scam-i-asked-the-founder-to-his-face/) · [NanoCorp](https://www.nanocorp.so/) · [Andon Market](https://andonlabs.com/market) · [AI Village 2025](https://aivillageblog.substack.com/p/what-we-learned-2025)
- Apple: [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) · [giving external agents access to Xcode](https://developer.apple.com/documentation/xcode/giving-external-agents-access-to-xcode) · [Xcode 27 release notes](https://developer.apple.com/documentation/xcode-release-notes/xcode-27-release-notes) · [App Store Connect API release notes](https://developer.apple.com/documentation/appstoreconnectapi/app-store-connect-api-release-notes) · [asc CLI](https://github.com/rorkai/App-Store-Connect-CLI) · [MobileBuildMCP](https://github.com/getsentry/XcodeBuildMCP) · [Maestro MCP](https://docs.maestro.dev/get-started/maestro-mcp) · [fastlane privacy upload](https://docs.fastlane.tools/uploading-app-privacy-details/)
- Google & web: [Play Developer API](https://developers.google.com/android-publisher/api-ref/rest) · [Play testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465) · [developer verification](https://developer.android.com/developer-verification) · [Chrome Web Store API v2](https://developer.chrome.com/blog/cws-api-v2) · [Expo MCP](https://docs.expo.dev/eas/ai/mcp/) · [Vercel deploy](https://vercel.com/docs/cli/deploy)
- Monetization: [RevenueCat MCP](https://www.revenuecat.com/docs/tools/mcp) · [Superwall MCP](https://superwall.com/docs/dashboard/guides/superwall-mcp) · [Adapty CLI](https://adapty.io/docs/developer-cli)
- Design: [frontend-design skill (Anthropic)](https://github.com/anthropics/skills) · [skills.sh](https://skills.sh) · [impeccable](https://github.com/pbakaus/impeccable) · [taste-skill](https://github.com/Leonxlnx/taste-skill) · [DESIGN.md](https://github.com/google-labs-code/design.md) · [Figma MCP](https://www.figma.com/blog/the-figma-canvas-is-now-open-to-agents/) · [Google Stitch SDK](https://github.com/google-labs-code/stitch-sdk) · [Recraft MCP](https://www.recraft.ai/docs/mcp-reference/remote-server) · [fal MCP](https://docs.fal.ai/model-apis/mcp) · [ElevenLabs MCP](https://github.com/elevenlabs/elevenlabs-mcp) · [Remotion skills](https://www.remotion.dev/docs/ai/skills) · [Sora discontinuation](https://help.openai.com/en/articles/20001152-what-to-know-about-the-sora-discontinuation)
- Anti-sameness research: [Verbalized Sampling (arXiv 2510.01171)](https://arxiv.org/abs/2510.01171) · [Artificial Hivemind (arXiv 2510.22954)](https://arxiv.org/abs/2510.22954)
- Payments & lanes: [Stripe global availability](https://stripe.com/global) · [Stripe Atlas](https://stripe.com/atlas) · [Paddle supported countries](https://www.paddle.com/help/start/intro-to-paddle/which-countries-are-supported-by-paddle) · [Polar supported countries](https://polar.sh/docs/merchant-of-record/supported-countries) · [Lemon Squeezy 2026 update](https://www.lemonsqueezy.com/blog/2026-update) · [Gumroad payouts](https://gumroad.com/help/article/13-getting-paid) · [Apify developer payouts](https://help.apify.com/en/articles/10057167-how-developer-payouts-work) · [Setapp revenue](https://docs.setapp.com/docs/setapp-membership-revenue) · [Google spam policies](https://developers.google.com/search/docs/essentials/spam-policies)
