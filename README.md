# Helmet Studio — 3D helmet livery configurator

A browser-based 3D configurator for motorbike helmet sticker kits. The flow and styling follow premium car configurators: a bright photo-studio stage, five numbered steps and a running price. Inside that flow, the Graphics step is a layer-based vinyl editor like those in Forza and Gran Turismo 7.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/ — host on Netlify, Vercel, S3, etc.
```

## The configurator flow

1. **Helmet**: the built-in *GP-R Track* shell, or upload a `.glb` model of your own helmet. Also sets the trim / hardware colour.
2. **Paint**: 16 named shell colours plus a custom colour picker, and seven finishes: Gloss, Satin, Matte, Metallic (with flake), Pearl, Chrome and exposed Carbon.
3. **Visor**: clear, smoke, iridium and mirror tints. Hide the visor to place graphics around the eye port.
4. **Graphics**: the livery editor (details below).
5. **Summary**: a studio render, the spec table, a price breakdown, **Request a quote**, and downloads (render PNG, real-size production print sheet, and the design file).

The price at the bottom of the panel updates live.

## The GP-R Track helmet

A procedural full-face race shell styled on modern track helmets such as the Pista GP. It has no manufacturer branding. Features:

- A long tail with an **integrated rear spoiler** that has endplates and a dark air channel underneath.
- Sculpted **visor pivot pods**.
- Twin **brow intakes** with sliders.
- A pointed chin bar with centre and lower intakes, and rear exhaust slots.
- A visor with a printed black border, tear-off posts and a lock tab.
- Rubber eye-port and neck-roll gaskets, and a quilted fabric comfort liner.

Stickers wrap across both the shell and the spoiler.

## Realism

- A custom **photo-studio environment**: overhead softbox, strip lights and a rim light, used for reflections.
- Soft shadows on a studio floor, plus a contact shadow.
- **Ground-truth ambient occlusion** (GTAO) in vents, seams and under the spoiler.
- Neutral tone mapping, so the colours customers pick stay true.
- Material detail: clear-coat orange peel, metallic flake, triplanar 2×2 twill carbon fibre, and fabric sheen on the liner.
- A light / dark studio toggle and a 360° turntable.

## Graphics editor

- **Layer list:** thumbnails, drag-to-reorder, show/hide, lock, duplicate and delete. Up to 100 layers.
- **On the helmet:** drag a graphic to move it, **Shift+drag** to rotate, **Alt+drag** to scale.
- **Properties:** real-cm sizes, rotation, wrap depth, flip, keep ratio, snap to the centre line, opacity and per-graphic film finish.
- **Mirror to other side:** either reflects the artwork or keeps numbers and text readable.
- **Artwork:** about 50 tintable presets (Shapes, Stripes, Racing, Patterns), text in 10 racing fonts, and your own images (upload, drag-and-drop or paste). One click removes a white background.
- Undo/redo, and autosave in the browser.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| Ctrl/Cmd+Z, Ctrl+Shift+Z / Ctrl+Y | Undo / redo |
| Ctrl+D | Duplicate |
| Delete | Delete graphic |
| Arrow keys (Shift = bigger steps) | Nudge |
| Q / E | Rotate |
| [ / ] | Shrink / grow |
| Ctrl+[ / Ctrl+] | Send backward / bring forward |
| M / H | Toggle mirror / visibility |
| Esc | Deselect |

## Setting your prices

All pricing lives in **`src/pricing.js`**: design fee, cost per piece, vinyl cost per cm², finish multipliers, minimum order and currency. **The values that ship are placeholders**, so set your own.

Set `orderEmail` there too. **Request a quote** then opens an email with the full spec and price, and downloads the design file and print sheet for the customer to attach. There's no backend yet. For real checkout, connect this step to Shopify, Stripe or a form service.

## Helmet models

Step 1 offers the helmets listed in **`src/models.js`**:

- **Race Pro** is loaded from `public/models/helmet.glb`. It is the default helmet when that file is present.
- **GP-R Track** is the built-in procedural shell. It is always available, and it is the fallback when a model file is missing.
- **Your own model** lets a visitor upload a `.glb` for their session only.

### Adding / replacing the model file

1. Optimise it first: 4K textures make files far too big for phones.
   ```bash
   npm run optimize-model -- original.glb public/models/helmet.glb
   ```
   This converts textures to 1024px WebP and compresses the geometry. The part names are kept, because the app uses them.
2. If the helmet faces backwards, set `rotationY` for it in `src/models.js`.
3. To offer several helmets, add more entries to `MODELS`.

### Licensing: model files are not committed

`public/models/*.glb` is in `.gitignore` on purpose.
- **The repo is public.** Committing a purchased model would redistribute it, which the Sketchfab Standard licence doesn't allow.
- **Deploying:** copy the file into `public/models/` in your hosting build instead, or make the repo private and commit it.
- **Licence types:** only use models whose licence allows **commercial** use. CC-BY-NC ("non-commercial") models are not allowed on a shop site. CC-BY models need the author credited on the site.

### How parts are detected

Parts are recognised from their mesh, parent-node and material names:
- `pad`, `interior`, `fabric`, `vent`, `grill`, `screw`, `alumin`, `plastic`, `rubber`, `trim` and similar keep their own material. Plastic parts follow the **Trim** colour.
- `visor`, `glass`, `lens` or `shield` get the tinted visor material.
- `logo`, `badge`, `brand` or `emblem` are **hidden**, so no third-party trademarks appear.
- Everything else is painted shell that takes stickers.

## Code map

| File | Purpose |
| --- | --- |
| `src/main.js` | App state, configurator steps, UI wiring, interaction, save/load |
| `src/scene.js` | Renderer, studio lighting, shadows, AO post-processing, camera views, renders |
| `src/helmet.js` | Procedural GP-R helmet, paint finishes, visors, GLB loader |
| `src/textures.js` | Procedural carbon weave, orange peel, flake and quilting textures |
| `src/decals.js` | Projecting stickers onto the shell and spoiler, picking, selection frame |
| `src/assets.js` | Preset / upload / text textures, background removal, print art |
| `src/presets.js` | Preset vinyl library (SVG), text styles, fonts |
| `src/pricing.js` | Sticker kit pricing (edit me) |
| `src/models.js` | Helmet models offered in step 1 |
| `src/printsheet.js` | Production print sheet renderer |
| `src/history.js` | Undo/redo |

Scale: 1 scene unit = 12.5 cm (`UNIT_CM` in `src/helmet.js`).
