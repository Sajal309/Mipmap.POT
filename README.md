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

## Share with colleague

### Option 1: Cloud link (GitHub Pages, recommended)

This repo is configured to auto-deploy from `main` using:

- `.github/workflows/deploy-pages.yml`

Steps:

1. Push your latest commit to `main`.
2. In GitHub, open **Settings > Pages** and set **Source** to **GitHub Actions** (one-time).
3. Wait for the **Deploy To GitHub Pages** workflow to finish.
4. Share this URL:
   - `https://<your-github-username>.github.io/<repo-name>/`
   - for this repo: `https://Sajal309.github.io/Mipmap.POT/`

Note: The build uses `VITE_BASE_PATH` in CI so hashed asset URLs work correctly on project pages.

### Option 2: Quick local share (same network)

```bash
npm run build
npm run preview -- --host 0.0.0.0 --port 4173
```

Then share your machine IP and port `4173` with your colleague.

## Share character history via Git

IndexedDB history is browser-local and cannot be pushed directly from Git.  
To share characters with teammates, commit them as shared presets:

1. Put character files under:
   - `public/shared-history/<character-name>/`
2. Add/update entries in:
   - `public/shared-history/manifest.json`
3. Commit and push those files.

On app startup, `manifest.json` is loaded and entries appear in **History** as shared presets.

This repo already includes two default shared presets:

- `Base Blue`
- `Base Orange`

Example entry:

```json
{
  "id": "hero",
  "name": "Hero",
  "createdAt": "2026-02-13T00:00:00Z",
  "images": ["shared-history/hero/hero.png"],
  "atlas": "shared-history/hero/hero.atlas",
  "skeleton": "shared-history/hero/hero.json",
  "animations": "shared-history/hero/hero-animations.json",
  "preview": "shared-history/hero/hero.png"
}
```

### Migrate characters you already uploaded on the live site

If those characters only exist in your live-browser history, run this in that page's DevTools Console.  
It downloads a `manifest.generated.json` containing your local history with inline `data:` assets.

```js
(async () => {
  const DB_NAME = 'spine-mipmap-preview-db';
  const STORE_NAME = 'characters';

  const openDb = () =>
    new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Failed to open IndexedDB.'));
    });

  const getAll = (db) =>
    new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error || new Error('Failed to read history records.'));
    });

  const toDataUrl = (blob) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('Failed to encode blob.'));
      reader.readAsDataURL(blob);
    });

  const slug = (value) =>
    String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || `char-${Date.now()}`;

  const db = await openDb();
  const records = await getAll(db);
  db.close();

  if (!records.length) {
    console.log('No history records found.');
    return;
  }

  const characters = [];
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    const id = slug(record.name || record.id || `character-${i + 1}`);

    const images = [];
    for (const img of record.imageFiles || []) {
      images.push(await toDataUrl(img));
    }

    characters.push({
      id,
      name: record.name || `Character ${i + 1}`,
      createdAt: new Date(record.createdAt || Date.now()).toISOString(),
      images,
      atlas: await toDataUrl(record.atlasFile),
      skeleton: await toDataUrl(record.jsonFile),
      ...(record.animationsFile ? { animations: await toDataUrl(record.animationsFile) } : {})
    });
  }

  const output = JSON.stringify({ characters }, null, 2);
  const blob = new Blob([output], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'manifest.generated.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  console.log(`Exported ${characters.length} character(s) to manifest.generated.json`);
})();
```

Then:

1. Replace `public/shared-history/manifest.json` with `manifest.generated.json`.
2. Commit and push.
3. Redeploy (GitHub Pages Action runs on push).
