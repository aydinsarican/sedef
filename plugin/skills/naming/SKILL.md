---
name: naming
description: Use when naming a product in the factory — divergent generation across naming patterns with Verbalized Sampling, pronunciation and meaning checks in English and Turkish, App Store and web collision checks, domain availability via RDAP, and pattern diversity against the novelty ledger.
---

# Naming

A good factory name is short, ownable, pronounceable in English and Turkish, carries no bad meaning in major languages, doesn't collide with an existing app or brand in the category, and doesn't follow the same pattern as the last few products.

## 1 · Generate across patterns (Verbalized Sampling)
Patterns: **coined** (portmanteau/invented), **real word** repurposed, **foreign word** (Turkish words that are easy in English — like *sedef*, mother-of-pearl — can be excellent), **compound**, **metaphor**, **verb**, **personal name**.
Avoid the pattern(s) used by the last 3 products in the ledger (`name_pattern`).

```text
<instructions>
Generate 20 names for the product below across the allowed patterns (≥ 3 per pattern), each in a separate
<response> with <text> (name — pattern — one-line rationale) and a numeric <probability> (how likely a typical
naming session would produce it). Sample from the tails: every probability below 0.10.
</instructions>
<product>…segment, wedge, voice, direction…</product>
```

## 2 · Screen (keep the top 6)
- ≤ 12 characters ideally; one or two syllables beat four.
- Say it aloud in English and Turkish; spell it after hearing it once.
- Meaning check in EN, TR, DE, ES, FR, AR — slang included (web search `"<name>" meaning slang`).
- Not a common verb/noun that's impossible to search for, unless paired with a descriptor in the store title.

## 3 · Collision checks (evidence in `.sedef/naming.md`)
- **App Store:** `mcp__sedef_data__fetch_json` → `https://itunes.apple.com/search?term=<name>&entity=software&country=us&limit=25` (and `country=tr`). Exact or near-identical names in the same category → drop.
- **Web:** search `"<name>" app`, `"<name>" <category>`.
- **Domain (RDAP):** `https://rdap.org/domain/<name>.com` (also `.app`, `.io`). HTTP 404 usually means unregistered; 200 means taken. Buying is a human chore; shipping on a subdomain is fine.
- **Trademark:** automated checks are unreliable. Record "not cleared" and add a non-blocking chore to search TÜRKPATENT, EUIPO and USPTO before the product's first release (≈10 minutes).

## 4 · Choose
Pick the name that best fits the voice and segment among survivors. The App Store title can be `Name — keyword phrase` within 30 characters; the subtitle carries another keyword phrase.

## Output — `.sedef/naming.md`
Top 3 with pattern, meaning checks, collisions, domain status, and the choice with rationale. Put the choice in `.sedef/verdict.json` → `title` and in the fingerprint → `name_pattern`.
