# Operations

## Rhythm
- **08:30** scout posts 0–3 idea cards → ✅ / ❌.
- **During the day** products move through stages; you hear about launches 🚀, approvals 🎉, rejections 📮, parked products 🧯 and blocking chores 🔑 (non-urgent messages wait for the end of quiet hours).
- **21:00** daily digest: what moved, spend vs budget, parked products, the chores waiting for you.
- **Sunday** portfolio review (📊 summary: double down / iterate / sunset) and retro (🧠 learnings + proposals).

## Telegram commands
| Command | Does |
|---|---|
| `/durum` | products by stage, spend, pending ideas and chores |
| `/fikir <text>` | your own idea goes straight into validation |
| `/onayla <id>` · `/gec <id>` | decide an idea card (same as the buttons) |
| `/isler` · `/tamam <id> [option]` | list / close chores |
| `/red <slug> <text>` | paste an App Review rejection |
| `/calistir <slug> <stage>` | force a product into a stage |
| `/oldur <slug>` | stop a product |
| `/dur [reason]` · `/devam` | kill switch: stop all sessions now / resume |
| `/butce` | spend today, this month, top products |
| `/oneriler` · `/uygula <n>` | skill proposals from the retro |

The same exist on the Mac: `sedef status | idea | approve | reject | chores | done | rejection | run | kill | pause | resume | budget | proposals`. While the daemon runs, mutating CLI commands are queued and applied on the next heartbeat.

## Where to look
| Question | Look at |
|---|---|
| What is the foreman doing? | `factory/logs/foreman.log`, `launchctl print gui/$(id -u)/com.sedef.foreman` |
| What did a session do? | `factory/logs/sessions/<date>/<slug>-<stage>-<ts>.jsonl` (tools, text, policy denials, stop-gate nudges, result) |
| Why did a stage fail? | `<product>/.sedef/feedback/<stage>.md` |
| Where is a product really? | `<product>/STATUS.md`, `.sedef/progress.json`, `git log` |
| What did it cost? | `/butce`, `factory/spend.jsonl` |
| What has the factory learned? | `factory/learnings/INDEX.md` |

## Failures the factory handles by itself
| What happens | What Sedef does |
|---|---|
| API key revoked, credit exhausted, account on hold (🔑) | Aborts the session on the first refusal instead of letting the SDK retry for minutes, gives the attempt back, **pauses the whole factory** and tells you what to fix. `/devam` after fixing. |
| Anthropic outage, overload, Mac offline (🌐) | The SDK retries first; if the session still dies, the product waits 15 → 30 → 60 min and the attempt is not counted. From the 4th loss in a row it counts like any failure, so a persistent problem still ends in a park. Factory jobs retry after 30 min. You hear about it on the 2nd loss in a row. |
| Mac slept / rebooted / the runner crashed mid-session | launchd restarts the foreman; the interrupted attempt is given back and the stage re-runs. |
| The runner itself throws while handling a product | The product is retried until its attempts are used up, then parked (🧯) — never an endless loop of paid sessions. |

Tuning: `CLAUDE_CODE_MAX_RETRIES` and `API_TIMEOUT_MS` in `~/.sedef/.env` are passed to every session.

## Common situations
- **A product is parked (🧯).** Read its feedback file. Fix the cause (credentials, a wrong contract, a missing tool), then `/calistir <slug> <stage>`. The weekly portfolio review can also unpark or kill it.
- **Budget reached.** Nothing new starts until the day/month rolls over; raise `budgets_usd` in the config if that's intended.
- **An MCP server shows problems in session logs** (`mcp_problems`): missing key (see `sedef doctor`), `needs-auth` (run `claude mcp login <name>` as the factory user; add the server first if it was never added — `sedef doctor` prints the exact line), or the provider is down — stages run without it.
- **You want to work on a product yourself.** `/dur` (or `sedef kill <slug>` if the factory should stop for good), open the repo in Claude Code with the plugin (`claude --plugin-dir ~/sedef/plugin`) and run `/sedef:takeover <slug>`. The phase-runner files tell you and Claude exactly where things stand. Hand back with `/devam` and `/calistir <slug> <stage>`.
- **App Review rejection.** With web-session automation off, the product waits for `/red <slug> <text>`. The fix, reply and resubmission are automatic; the lesson goes into learnings.

## Stopping and uninstalling
```bash
launchctl bootout gui/$(id -u)/com.sedef.foreman     # stop the service
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.sedef.foreman.plist   # start again
rm ~/Library/LaunchAgents/com.sedef.foreman.plist && rm "$(brew --prefix)/bin/sedef"   # uninstall
```
Product repos, `factory/` and `~/.sedef/` are left alone; delete them yourself if you want.

## Safety checklist (monthly)
- Console spend vs. `/butce` — they should roughly agree (session costs are estimates).
- Review `factory/logs/sessions/*` for repeated policy denials — they point at missing capabilities or bad instructions.
- Rotate tokens in `~/.sedef/.env`; confirm `~/.sedef` is `700` and `.env` is `600`.
- Check the developer accounts for any policy warnings before raising submission caps.
