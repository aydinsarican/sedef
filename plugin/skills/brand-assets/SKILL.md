---
name: brand-assets
description: Use when producing app icons, illustrations, brand textures, sounds or other visual assets in the factory — icon principles, the generation pipeline across available MCP servers (Recraft, fal, Replicate, Stitch, Figma, Blender) with a no-MCP fallback, asset-catalog formats, provenance and licensing.
---

# Brand assets

## App icon
**Principles:** one bold idea, no words, readable at 29 pt, a silhouette that differs from the ledger's recent icons and from category leaders, no photographic UI, no transparency on iOS (the 1024 master has no alpha). Echo the product's signature shape from DESIGN.md.

**Pipeline — explore → pick → refine (tool calls are budget-capped per session; plan before generating):**
1. Write 3 icon concepts from the direction (`app_icon_form` + material + color model).
2. Generate with what this session has:
   - **Recraft** (`mcp__recraft__generate_image`, `vectorize_image`): true SVG; create one custom style per product from a reference so every asset shares it.
   - **fal** (`mcp__fal__search_models` → `get_pricing` → `run_model`): raster explorations (Nano Banana family for edits and consistency, FLUX, Ideogram for type-heavy art — never for icons with words).
   - **Replicate** (`mcp__replicate__create_predictions`) as an alternative host.
   - **Figma** (`use_figma`; load `/figma-use` first) when the brand should also live as a component library.
   - **Blender** (object-render icons) only if a Blender MCP is connected on the host.
   - **No MCP available:** construct the SVG by hand — geometric primitives on a 1024 grid, one or two colors from DESIGN.md — then rasterize.
3. Keep `design/brand/icon.svg` as the editable master.
4. Rasterize and flatten:
   ```bash
   rsvg-convert -w 1024 -h 1024 design/brand/icon.svg -o /tmp/icon.png
   magick /tmp/icon.png -background "<background hex>" -alpha remove -alpha off design/brand/icon-1024.png
   ```
5. iOS dark and tinted appearances (iOS 18+): `icon-dark-1024.png` (glyph on dark/transparent-looking dark background) and `icon-tinted-1024.png` (grayscale glyph). Asset catalog `AppIcon.appiconset/Contents.json`:
   ```json
   {
     "images": [
       { "filename": "icon-1024.png", "idiom": "universal", "platform": "ios", "size": "1024x1024" },
       { "appearances": [{ "appearance": "luminosity", "value": "dark" }], "filename": "icon-dark-1024.png", "idiom": "universal", "platform": "ios", "size": "1024x1024" },
       { "appearances": [{ "appearance": "luminosity", "value": "tinted" }], "filename": "icon-tinted-1024.png", "idiom": "universal", "platform": "ios", "size": "1024x1024" }
     ],
     "info": { "author": "xcode", "version": 1 }
   }
   ```
   iOS 26+ also supports layered Icon Composer (`.icon`) files for Liquid Glass rendering; if you produce one, keep the flat PNG set as the fallback.

## Illustration system
One technique per product (the drawn `illustration_technique`), generated with a fixed style reference so every image belongs together. Typical v1 set: 3 onboarding, 2–3 empty states, 1 paywall hero, 1 store feature graphic. Prefer vector for UI; raster only where texture is the point.

## Brand textures
Generative patterns seeded by the product slug (SVG or p5.js, then rasterized) give each product a texture nobody else has — backgrounds, paywall headers, store screenshot frames.

## Sound (only if the direction's `sound_haptics` calls for it)
3–5 short UI sounds via ElevenLabs sound effects; subtle, mixed under −18 LUFS, always mutable, never on by default for silent-mode users. Licensed music for previews only from sources cleared for commercial use.

## Provenance & rights
- Log every generated asset in `design/brand/provenance.md`: tool/model, prompt summary, date, edits.
- Use only assets you have rights to: generated here, SIL-OFL fonts, or created by hand. App Store guideline 2.3.9 requires rights to everything in the listing.
- Purely AI-generated images may not be protectable by copyright (US courts left that position in place in 2026). For a product that earns real money, a human-edited logo master is a sensible optional chore.
- Never imitate another brand's mascot, icon or trade dress.
