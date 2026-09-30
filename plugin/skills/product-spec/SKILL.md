---
name: product-spec
description: Use when writing or extending a product spec in the factory — lean PRD, feature_list.json with testable acceptance, phase files in the phase-runner convention, STATUS.md/DECISIONS.md, progress.json, and the acceptance contracts (Maestro flows or Playwright specs) that become immutable during the build.
---

# Product spec — small v1, machine-checkable contracts

The spec is the only place where "done" is defined. Builders cannot edit the contracts; the evaluator judges against them; the foreman counts phases. Vague specs produce fake progress.

## 1 · `.sedef/spec.md` (lean PRD)
Sections, in order:
1. **Problem** — in the segment's words, with 2–3 evidence links from the brief.
2. **Segment & wedge** — who exactly, and the one thing we do differently.
3. **v1 scope** — ≤ 5 features. One core loop done beautifully.
4. **Later** — everything cut, so no one sneaks it back in.
5. **Success metrics** — activation event, D1/D7 retention target, trial→paid target, first-week install goal.
6. **Monetization** — model, price, trial, paywall placement (after first value, never before), restore, what's free forever.
7. **Analytics events** — ≤ 12, `snake_case` verbs (`onboarding_completed`, `entry_created`, `paywall_viewed`, `trial_started`). No personal data in event properties.
8. **Privacy data map** — table: data item · purpose · stored where · linked to user? · used for tracking? · third parties. This becomes the store privacy label; keep it honest and minimal.
9. **AI usage** (if any) — prefer on-device models (Apple Foundation Models on supported devices) for privacy and zero API cost; if personal data goes to a third-party AI, v1 includes an explicit consent screen (App Review 5.1.2(i)).
10. **Platform integrations** — widgets, Live Activities, App Intents, share extensions — only if they serve the core loop.

## 2 · `.sedef/feature_list.json`
```json
[
  {
    "id": "F1-onboarding",
    "title": "Value-first onboarding",
    "phase": "phase-02",
    "user_story": "As a new user I see what the app does for me before any sign-up.",
    "acceptance": [
      "First launch shows the core value screen within 1 s with element onboarding.hero visible",
      "Tapping onboarding.continue lands on the core screen (core.list) without creating an account",
      "VoiceOver reads onboarding.hero's label"
    ],
    "accessibility_ids": ["onboarding.hero", "onboarding.continue", "core.list"],
    "passes": false
  }
]
```
Rules: ids `F<n>-<kebab>`; acceptance statements are observable (element ids, stored values, visible text in both locales); accessibility ids are `<screen>.<element>`; `passes` starts `false` and only the evaluator flips it.

## 3 · Phases (phase-runner convention, autonomous edition)
4–8 phases, each a vertical slice that leaves the app runnable. A typical iOS v1:
1. **phase-01 Foundation ✅CP** — project generation (XcodeGen/Expo/Vite), Theme generated from DESIGN.md, CI verify green, empty app launches.
2. **phase-02 Core data & first-run** — model, persistence, onboarding.
3. **phase-03 Core loop UI** — the screens people will use daily.
4. **phase-04 Monetization ✅CP** — paywall, purchase, restore, entitlement gating (StoreKit configuration file for local tests).
5. **phase-05 Settings, privacy & data** — support/privacy links, export, account deletion if accounts exist.
6. **phase-06 Polish ✅CP** — localization (EN + TR), accessibility pass, motion signature moments, widgets if in scope.

Phase file template (`docs/phases/phase-02.md`):
```markdown
# Phase 02 — Core data & first-run
## Goal (Amaç)
…one paragraph…
## Scope (Kapsam)
- …
## Out of scope (Kapsam DIŞI)
- …
## Acceptance criteria (Kabul kriterleri)
- [ ] F1-onboarding: … (contract: .maestro/acceptance/F1-onboarding.yaml)
- [ ] Unit tests for EntryStore pass
## Blockers (Bloklayan)
- none | human-only items (also in .sedef/chores.json)
```
Mark checkpoint phases with `✅CP` in the title.

## 4 · `STATUS.md`
```markdown
# <Product> — STATUS
Active phase: phase-01
| Phase | Title | Status |
|---|---|---|
| 01 | Foundation ✅CP | ⬜ |
…
## Human Setup
- (mirrors .sedef/chores.json)
## Known issues
## Backlog
## Son Oturum Notu / Session note
- YYYY-MM-DD · Phase N (status): what was done. Next: … Blockers: none.
```

## 5 · `docs/DECISIONS.md` — autonomous rule
There is no human to ask. Resolve open questions yourself using the brief as tiebreaker and record:
- `✅` locked — decided with evidence; changing it needs a new decision entry.
- `🤖` auto-decided — include rationale and **how to reverse** it cheaply.
- `❓` only for human-only matters (legal entity, contracts, paid accounts) — each also becomes a chore.

## 6 · `.sedef/progress.json`
`{"phases_total": 6, "phases_done": 0, "complete": false, "current": 1}` — the foreman requires `phases_done` to increase every build session.

## 7 · Acceptance contracts (immutable during build)

**Maestro (iOS/Expo)** — `.maestro/acceptance/F1-onboarding.yaml`:
```yaml
appId: ${APP_ID}
tags:
  - phase-02
---
- launchApp:
    clearState: true
- assertVisible:
    id: "onboarding.hero"
- tapOn:
    id: "onboarding.continue"
- assertVisible:
    id: "core.list"
- takeScreenshot: F1-onboarding-done
```
The lane's `verify.sh` passes `APP_ID` with `-e APP_ID=<bundle id>` and runs flows by tag.

**Playwright (web/extension)** — `tests/acceptance/F1-onboarding.spec.ts`:
```ts
import { test, expect } from '@playwright/test';
test('@phase-02 F1 value-first onboarding', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('onboarding.hero')).toBeVisible();
  await page.getByTestId('onboarding.continue').click();
  await expect(page.getByTestId('core.list')).toBeVisible();
});
```

Contracts describe what the user can do and see. Never assert on implementation details, timings tighter than the user would notice, or copy that localization will change (use ids).

## 8 · Chores for humans (shared format)
`.sedef/chores.json` is an array of
`{"key":"stable-unique-key","kind":"account|payment|legal|apple_app_record|…","title":"<short Turkish>","instructions":"<Turkish, exact values to paste, ≤ 6 lines>","minutes":3,"blocking":false}`.
`blocking: true` pauses the product until the human closes it — use only when work truly cannot continue.
The file is an outbox: the foreman takes its entries after the session and empties it; answers come back in `.sedef/chore-answers.json`. Read that before asking again.
