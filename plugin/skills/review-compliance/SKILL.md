---
name: review-compliance
description: Use before any store submission, after any rejection, and when validating ideas — the App Store, Google Play and Chrome Web Store rules most likely to hit an agent-built product (including Apple's June 2026 update on low-effort and repeated submissions), and how to report findings.
---

# Review & policy compliance

The factory shares one developer account across every product. One "spam" strike can cost the account — and every app on it. Compliance is a portfolio risk, not a per-app chore.

## Apple (App Review Guidelines, updated June 2026)
**Spam & duplication — 4.3**
- 4.3(a): one app per concept; no multiple bundle IDs for the same app; no near-identical apps across the portfolio.
- 4.3(b) (June 2026 wording, paraphrased): crowded categories — dating, flashlight, wallpaper, timer, fortune-telling and similar — are rejected unless the app is meaningfully different or improved; apps that are not improved or don't attract customers can be removed; repeated low-effort submissions can lead to removal from the Developer Program. → Hence the factory's hard cap on new submissions per 30 days and the novelty ledger.
- 4.1: no copycats of other apps' names, icons, UI or trade dress.

**Functionality — 4.2 / 2.1**
- 4.2: real utility; not a repackaged website, not a thin wrapper around one API call.
- 4.2.6: apps made from templates/app generators are rejected unless submitted by the content owner — every factory app must be genuinely designed and built for its segment (it is), and must not look templated (it must not).
- 2.1: complete — no placeholders, no crashes, no dead buttons; demo account for anything behind login.

**Payments — 3.1**
- 3.1.1: digital goods and features unlock through In-App Purchase.
- 3.1.2: subscriptions — ongoing value, clear price and period before purchase, trial terms, how to cancel, **Restore Purchases**, links to Terms (EULA) and Privacy in the app and in the listing.

**Privacy — 5.1**
- 5.1.1: privacy policy link in app and listing; purpose strings; ask in context; data minimization; **in-app account deletion** if accounts exist.
- 5.1.2(i): explicit consent before sharing personal data with third-party AI.
- Privacy manifest (`PrivacyInfo.xcprivacy`) and required-reason API declarations consistent with the binary; privacy label consistent with reality.

**Metadata — 2.3**
- Screenshots show the actual app; 2.3.4: previews are screen captures of the app; no misleading claims, prices or "#1" boasts; no competitor names in keywords (2.3.7); rights to every asset (2.3.9).

**Other frequent hits:** 4.8 Sign in with Apple when third-party social login exists; 1.4 physical-harm/health claims; Kids category rules; background modes justified; encryption export flag set.

## Google Play
- Repetitive content: multiple apps with highly similar functionality, content and experience are disallowed.
- Data safety form must match the app (the API can write it; keep it true).
- Personal developer accounts (created after Nov 2023): closed test with ≥ 12 opted-in testers for 14 consecutive days before applying for production. Organization accounts are exempt.
- Developer verification: Play-distributed apps must be registered in Play Console; install-time checks started in several countries in late Sep 2026 and go global in 2027.
- Families, deceptive behavior, subscriptions and metadata policies mirror Apple's spirit.

## Chrome Web Store
Single purpose; minimal permissions with justifications; no remote code; accurate privacy tab; affiliate links disclosed and valuable (2025); stricter data-collection limits since 1 Aug 2026.

## Reporting format — `.sedef/compliance.json`
```json
{"pass": false, "reviewed_at": "YYYY-MM-DD", "findings": [
  {"guideline": "3.1.2", "severity": "blocker", "where": "PaywallView", "issue": "No Restore Purchases button", "fix": "Add restore action and link Terms/Privacy under the price"}
]}
```
`pass` is true only with zero blockers. Add a readable `.sedef/compliance.md`.

## After a rejection
Classify: product defect · metadata problem · missing reviewer information · reviewer misunderstanding. Fix the cause, reply briefly and factually, resubmit, and record the lesson in `.sedef/learnings.md` so the weekly retro turns it into a checklist item for every future product.
