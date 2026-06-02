# Icons

This folder contains icons generated from `poh-miner.svg` (a green network/brain symbol).

## Generated Files

| File                        | Purpose                     | Used By          |
|----------------------------|-----------------------------|------------------|
| `poh-miner.svg`            | Source (edit this)          | All platforms    |
| `poh-miner-*.png`          | Raster icons (various sizes)| Linux fallback   |
| `poh-miner-1024.png`       | High-res PNG                | macOS fallback   |
| `poh-miner.ico`            | Windows icon                | Windows          |
| `poh-miner.iconset/`       | macOS iconset folder        | Generate .icns   |

## macOS (.icns)

The best quality macOS icon requires a `.icns` file.

**On a Mac**, run:

```bash
iconutil -c icns assets/icons/poh-miner.iconset -o assets/icons/poh-miner.icns
```

Then update `package.json` build config to use:
```json
"icon": "assets/icons/poh-miner.icns"
```

## Regenerating Icons

After modifying `poh-miner.svg`, simply run:

```bash
node scripts/generate-icons.js
```

## Requirements

The generation script uses:
- `sharp` (SVG → high quality PNG)
- `png-to-ico` (.ico creation)

These are listed as devDependencies.
