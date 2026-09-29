# Helmet Livery Studio

A browser-based 3D motorbike helmet sticker designer, laid out like the livery / vinyl-group editors in Forza and Gran Turismo 7.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/ — host on Netlify, Vercel, S3, etc.
```

## Features

**Layer-based vinyl editor**
- Layer stack with thumbnails, drag-to-reorder, show/hide, lock, duplicate and delete. Up to 100 layers.
- Stickers are projected onto the curved shell as decals, so they wrap around the helmet.
- On the helmet: **drag** a sticker to move it, **Shift+drag** to rotate, **Alt+drag** to scale. Drag an empty area to orbit, and use the wheel to zoom.
- The properties panel sets size in real centimetres, rotation, wrap depth, flip H/V, keep ratio, snap to the centre line, opacity and a per-sticker finish (gloss, matte, satin, metallic, pearl or chrome).
- **Mirror to other side** puts an automatic copy on the opposite side. It can either reflect the artwork or keep it readable, for numbers and names.
- Undo/redo, autosave in the browser, and save/open as a `.json` design file (uploaded images are embedded in it).

**Artwork sources**
- Preset library of around 50 vinyls in four categories: Shapes, Stripes, Racing and Patterns. All of them are white vector art that can be tinted to any colour.
- Text stickers in 10 racing / display fonts, with fill, outline and letter spacing.
- Your own images: upload, drag-and-drop or paste (PNG, JPG, SVG…). A one-click **Remove white background** turns logos into clean cut-outs.

**Helmet**
- A procedural full-face helmet, with paint colour and finish, eight visor tints (smoke, iridium, mirror, rainbow) and trim colour.
- **Load your own `.glb` helmet model** for your real product range. Name meshes `visor`/`glass`/`lens` to use the visor material; name meshes `trim`/`rubber`/`vent`/`liner`/`strap` to keep their own material. Everything else can be painted and take stickers.

**Export**
- A high-resolution PNG render, with an optional transparent background, for shop listings.
- **Production print sheet**: every sticker laid out flat at real size, including mirrored copies. Each one has a cut box, a label, its dimensions and finish, plus the shell spec and a preview render. It comes at 150 DPI (proof) or 300 DPI (print). Sizes are flat approximations of stickers that wrap onto a curved surface, so test-fit before a production run.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| Ctrl/Cmd+Z, Ctrl+Shift+Z / Ctrl+Y | Undo / redo |
| Ctrl+D | Duplicate |
| Delete | Delete sticker |
| Arrow keys (Shift = bigger steps) | Nudge |
| Q / E | Rotate |
| [ / ] | Shrink / grow |
| Ctrl+[ / Ctrl+] | Move layer down / up |
| M / H | Toggle mirror / visibility |
| Esc | Deselect |

## Code map

| File | Purpose |
| --- | --- |
| `src/main.js` | App state, UI wiring, interaction, save/load |
| `src/scene.js` | Renderer, lighting, camera views, screenshots |
| `src/helmet.js` | Procedural helmet, finishes, visors, GLB loader |
| `src/decals.js` | Projecting stickers onto the shell, picking, selection frame |
| `src/assets.js` | Preset/upload/text textures, background removal, print art |
| `src/presets.js` | Preset vinyl library (SVG), text styles, fonts |
| `src/printsheet.js` | Production sheet renderer |
| `src/history.js` | Undo/redo |

To add presets, add an entry to `PRESET_CATEGORIES` in `src/presets.js`. Draw it as white SVG on a transparent background so it can be tinted.

Scale: 1 scene unit = 12.5 cm (`UNIT_CM` in `src/helmet.js`). The default shell is about 30 cm long.
