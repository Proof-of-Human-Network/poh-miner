# Icons

This folder contains icons generated from the AIHub logo (`dai-miner-source.png`).

## Files

- `dai-miner-source.png` — Canonical logo (edit / replace this for design changes)
- `dai-miner.svg` — PNG-backed SVG for landing / in-app use
- `dai-miner-*.png` — Raster versions in various sizes
- `dai-miner.ico` — Windows icon
- `dai-miner.iconset/` — macOS iconset (convert to .icns on macOS)

## How to generate .icns (macOS only)

On a Mac, run:

```bash
iconutil -c icns assets/icons/dai-miner.iconset -o assets/icons/dai-miner.icns
```

Then delete the .iconset folder if desired.

## Regenerating icons

After replacing `dai-miner-source.png`, run:

```bash
node scripts/generate-icons.js
```
