# Shared Character History

Add character bundles here so they can be committed to Git and loaded automatically for every user.

## Required files per character

- one or more `.png` atlas page images
- one `.atlas` file
- one skeleton file (`.json` or `.skel`)
- optional animations `.json`

## Manifest

Update `manifest.json` with one entry per character:

```json
{
  "characters": [
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
  ]
}
```

Notes:

- Paths are relative to the app root and should stay under `public/shared-history`.
- `images`, `atlas`, and `skeleton` are required.
- `preview` is optional (defaults to first image).

Default presets currently shipped in this repo:

- `Base Blue` (`shared-history/base-blue/*`)
- `Base Orange` (`shared-history/base-orange/*`)
