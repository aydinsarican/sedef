# DESIGN.md template (Google DESIGN.md spec, version "alpha")

Keys in the front matter: `version`, `name`, `description`, `colors`, `typography`, `rounded`, `spacing`, `components` (optionally `omitted`).
Typography fields: `fontFamily`, `fontSize`, `fontWeight`, `lineHeight`, `letterSpacing`, `fontFeature`, `fontVariation`.
Component fields: `backgroundColor`, `textColor`, `typography`, `rounded`, `padding`, `size`, `height`, `width`. Variants are separate keys (`button-primary-pressed`).
References use `"{colors.primary}"`. Dimensions use px, em or rem. There are no motion or elevation tokens: describe elevation in prose, motion in `design/motion.md`.
Validate with `npx -y @google/design.md@0.4.0 lint DESIGN.md` (exit 1 on errors).

Replace every value below — this skeleton is deliberately neutral so nothing leaks from one product to the next.

```markdown
---
version: alpha
name: <Product Name>
description: "<one line — who it is for and the feeling it should leave>"
colors:
  ink: "#1B1B1F"
  paper: "#F5F3EE"
  primary: "#2B59C3"
  on-primary: "#FFFFFF"
  accent: "#E0A526"
  muted: "#6E6C66"
  danger: "#B3261E"
  ink-dark: "#EDEBE6"
  paper-dark: "#141416"
typography:
  display-lg: { fontFamily: <Display Face>, fontSize: 40px, fontWeight: 600, lineHeight: 1.05, letterSpacing: -0.02em }
  display-md: { fontFamily: <Display Face>, fontSize: 28px, fontWeight: 600, lineHeight: 1.1 }
  body-lg:    { fontFamily: <Text Face>, fontSize: 19px, fontWeight: 400, lineHeight: 1.45 }
  body-md:    { fontFamily: <Text Face>, fontSize: 17px, fontWeight: 400, lineHeight: 1.45 }
  label-md:   { fontFamily: <Text Face>, fontSize: 15px, fontWeight: 600, lineHeight: 1.2, fontFeature: "tnum" }
rounded:
  sm: 6px
  md: 14px
  lg: 24px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 40px
components:
  button-primary: { backgroundColor: "{colors.primary}", textColor: "{colors.on-primary}", typography: "{typography.label-md}", rounded: "{rounded.md}", padding: 16px, height: 52px }
  button-primary-pressed: { backgroundColor: "{colors.ink}", textColor: "{colors.on-primary}", typography: "{typography.label-md}", rounded: "{rounded.md}", padding: 16px, height: 52px }
  card: { backgroundColor: "{colors.paper}", textColor: "{colors.ink}", rounded: "{rounded.lg}", padding: 20px }
  card-dark: { backgroundColor: "{colors.paper-dark}", textColor: "{colors.ink-dark}", rounded: "{rounded.lg}", padding: 20px }
  chip-accent: { backgroundColor: "{colors.accent}", textColor: "{colors.ink}", typography: "{typography.label-md}", rounded: "{rounded.sm}", padding: 8px }
  caption: { textColor: "{colors.muted}", typography: "{typography.body-md}" }
  alert-danger: { backgroundColor: "{colors.danger}", textColor: "{colors.on-primary}", typography: "{typography.body-md}", rounded: "{rounded.md}", padding: 16px }
---

## Overview
<The direction in two paragraphs: the drawn ingredients, the reference worlds (print, packaging, architecture …), the feeling, and what this product must never look like.>

## Colors
<Each color's job. Contrast pairs that are allowed. How dark mode shifts chroma and neutrals.>

## Typography
<Why this pairing. Scale and rhythm. Numerals. Dynamic Type behavior on iOS. Licenses (OFL / system).>

## Layout
<Grid, margins, density, the rule for the first screen.>

## Elevation & Depth
<How layers separate without drop-shadow soup. Relationship with the system's Liquid Glass chrome.>

## Shapes
<Corner language, strokes, the signature shape (it should echo the icon).>

## Components
<Buttons, cards, lists, inputs, paywall, empty states — how each carries the brand.>

## Do's and Don'ts
- Do …
- Don't … (include the anti-clichés this direction is most tempted by)
```
