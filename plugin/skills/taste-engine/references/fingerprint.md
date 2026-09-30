# `.sedef/fingerprint.json`

The factory compares this against the last products in `factory/ledger/novelty.jsonl` (`sedef novelty check`). The `direction` keys are the constraint-deck axes; use the drawn ids verbatim so distances are meaningful.

```json
{
  "product": "<slug>",
  "lane": "ios",
  "category": "<one or two words, e.g. 'sleep', 'personal-finance', 'language-learning'>",
  "core_mechanic": "<e.g. 'streaks', 'collections', 'timeline', 'swipe-triage', 'map-journal'>",
  "audience": "<segment in a few words>",
  "monetization": "<subscription | one-time | freemium-iap | ads | usage-based>",
  "direction": {
    "era_movement": "constructivism",
    "material_texture": "enamel",
    "typeface_class": "didone",
    "color_model": "mono-plus-one-accent",
    "grid_layout": "type-as-hero",
    "motion_character": "soft-organic",
    "illustration_technique": "abstract-shapes",
    "iconography": "pictogram-system",
    "voice_tone": "poetic-minimal",
    "sound_haptics": "musical-notes",
    "app_icon_form": "monogram"
  },
  "palette": { "primary": "#B3261E", "accent": "#1B1B1F", "background": "#F5F3EE" },
  "fonts": ["<Display Face>", "<Text Face>"],
  "icon_style": "<app_icon_form + technique, e.g. 'monogram-enamel'>",
  "name_pattern": "<coined | real-word | foreign-word | compound | metaphor | verb | personal-name>"
}
```

Rules
- At least four direction axes; the check fails otherwise.
- `palette.primary` must be a hex color.
- System UI faces (SF Pro, SF Compact, New York, Roboto, Segoe UI, system-ui) may appear as secondary faces; the brand face must not repeat within the font window.
