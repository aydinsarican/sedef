# factory/ — runtime state

| Path | Owner | What |
|---|---|---|
| `state.json` | foreman | products, ideas, chores, submissions, schedule (single source of truth) |
| `spend.jsonl` | foreman | one row per session: cost, turns, outcome |
| `ledger/novelty.jsonl` | foreman | brand fingerprints of every branded product (novelty check input) |
| `ideas/cards/` | scout | idea cards (`.json` + `.md`) waiting for your ✅/❌ |
| `learnings/` | retro | the factory's memory — read by every session |
| `proposals/` | retro | skill-change proposals (`/uygula <n>` to apply) |
| `portfolio/`, `reports/` | portfolio, retro | weekly decisions and reports |
| `logs/` | foreman | `foreman.log`, `sessions/<date>/*.jsonl` transcripts, launchd logs |
| `inbox/` | CLI | commands queued while the daemon runs |

Everything here except `learnings/` is git-ignored.
