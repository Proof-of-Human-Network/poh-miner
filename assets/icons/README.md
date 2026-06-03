# Icons

This folder contains icons generated from the official PoH logo in brand kit (svg/logo no bg.svg and variants), copied to assets/logos/ and assets/icons/poh-miner.svg as canonical.

## Files

- `poh-miner.svg` — Source vector (edit this for design changes)
- `poh-miner-*.png` — Raster versions in various sizes
- `poh-miner.ico` — Windows icon
- `poh-miner.iconset/` — macOS iconset (convert to .icns on macOS)

## How to generate .icns (macOS only)

On a Mac, run:

```bash
iconutil -c icns assets/icons/poh-miner.iconset -o assets/icons/poh-miner.icns
```

Then delete the .iconset folder if desired.

## Regenerating icons

After editing the SVG, run:

```bash
node scripts/generate-icons.js
```
