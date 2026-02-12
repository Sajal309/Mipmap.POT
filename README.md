# Spine Mipmap Preview (PixiJS v6 + pixi-spine)

Minimal production-grade local runtime to preview Spine 3.8-style characters with POT validation and mipmap verification.

## Tech stack

- `pixi.js` `^6.x`
- `pixi-spine` compatible with Spine 3.8 style assets
- Vanilla JS + Vite

## Setup

```bash
npm i
npm run dev
```

Open the Vite URL in your browser.

## How to use

1. In **Add spine**, upload:
   1. `image` (`.png`, one or more)
   2. `atlas` (`.atlas`)
   3. `json` (skeleton `.json`)
2. Click **Add**.
3. Use controls:
   - **Mipmaps ON/OFF**
   - **Manual POT override** with POT width/height (pads pages without scaling)
   - **Scale test 0.25x / 0.5x / 1.0x**
   - **Pan test ON/OFF**
4. Click animation names in **Animations** to play looping animations.
5. Loaded characters are saved to **Character history**; click an entry to reload instantly without reuploading files.

## Runtime behavior

- Loads from local `File` objects using `URL.createObjectURL`.
- Parses atlas text and patches atlas page references to blob URLs.
- Supports multi-page atlases when all referenced page images are uploaded.
- If atlas page names do not match uploaded PNG names, runtime auto-maps and warns.
- Revokes object URLs on reload to avoid leaks.
- Optional manual POT override pads each atlas page to chosen POT width/height before load (no atlas coordinate distortion).
- Character bundles are persisted in IndexedDB and can be reloaded from the sidebar history section.

## Mipmap verification (required checks)

### A) Programmatic / WebGL parameter check

After loading:

- Shows renderer (`WebGL1`/`WebGL2`), max texture size, DPR, zoom, skeleton scale.
- For each atlas page, prints in UI + console:
  - `isPOT`
  - `baseTexture.mipmap` mode
  - width/height
  - `TEXTURE_MIN_FILTER`
  - `TEXTURE_MAG_FILTER`
- `Mipmaps status: ENABLED (sampling)` is shown only when:
  - texture is POT
  - mipmap mode is ON
  - min filter is a mipmap filter (`LINEAR_MIPMAP_LINEAR`, etc.)

### B) Visual A/B toggle

Compare shimmer while downscaled:

1. Set scale to `0.25x` or `0.5x`.
2. Turn **Pan test ON**.
3. Set mipmaps OFF and inspect edges.
4. Set mipmaps ON and compare reduced shimmer/aliasing.
5. Optional: enable manual POT override (e.g. `2048x2048`) when source pages are NPOT to test mipmap path.

UI reminder: _For best test, set scale to 0.25-0.4 and watch edges during motion._

### C) Debug overlay

Overlay displays:

- WebGL version
- max texture size
- device pixel ratio
- current zoom
- current skeleton scale
- POT state + mipmap sampling status
- NPOT warnings

## Troubleshooting

### Atlas filename mismatch

If atlas page names differ from uploaded PNG names, runtime maps available files and patches page lines to blob URLs. A warning is shown in the sidebar.

### Missing regions / missing page images

If atlas references pages that were not uploaded, load fails with a clear list of missing page names.

### NPOT textures

If a page is non-power-of-two, runtime marks `Texture POT: NO (...)`, disables mipmaps, and explains why. For WebGL1 this avoids unsupported NPOT mipmapping behavior.

### GL filter not sticking

Runtime forces filters after texture bind and bumps Pixi style dirty state before update. If needed, toggle **Mipmaps ON/OFF** once to re-apply and verify MIN/MAG filters in the panel.
