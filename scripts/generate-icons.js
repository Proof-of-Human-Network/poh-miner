#!/usr/bin/env node
/**
 * Generate all required icons for Electron packaging from the source PNG.
 *
 * Usage:
 *   node scripts/generate-icons.js
 */

import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SRC_PATH = path.join(ROOT, 'assets/icons/dai-miner-source.png');
const ICONS_DIR = path.join(ROOT, 'assets/icons');

// Required sizes for different platforms
const PNG_SIZES = [16, 32, 48, 64, 128, 256, 512, 1024];

async function generateIcons() {
  console.log('🎨 Generating icons from dai-miner-source.png...\n');

  if (!fs.existsSync(SRC_PATH)) {
    console.error('❌ Source PNG not found at:', SRC_PATH);
    process.exit(1);
  }

  // Ensure icons directory exists
  if (!fs.existsSync(ICONS_DIR)) {
    fs.mkdirSync(ICONS_DIR, { recursive: true });
  }

  // Generate PNGs in multiple sizes
  console.log('→ Generating PNGs...');
  const pngPaths = [];

  for (const size of PNG_SIZES) {
    const outputPath = path.join(ICONS_DIR, `dai-miner-${size}.png`);
    
    await sharp(SRC_PATH)
      .resize(size, size)
      .png()
      .toFile(outputPath);

    pngPaths.push(outputPath);
    console.log(`   ✓ ${size}x${size}`);
  }

  // Generate Windows .ico as PNG-in-ICO (electron-builder requires a ≥256px frame).
  console.log('\n→ Generating Windows .ico...');
  try {
    const icoSizes = [16, 32, 48, 256];
    const blobs = icoSizes.map(s => fs.readFileSync(path.join(ICONS_DIR, `dai-miner-${s}.png`)));
    const count = icoSizes.length;
    const header = Buffer.alloc(6 + 16 * count);
    header.writeUInt16LE(0, 0);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(count, 4);
    let offset = 6 + 16 * count;
    const chunks = [header];
    icoSizes.forEach((s, i) => {
      const entry = 6 + 16 * i;
      header.writeUInt8(s >= 256 ? 0 : s, entry);
      header.writeUInt8(s >= 256 ? 0 : s, entry + 1);
      header.writeUInt8(0, entry + 2);
      header.writeUInt8(0, entry + 3);
      header.writeUInt16LE(1, entry + 4);
      header.writeUInt16LE(32, entry + 6);
      header.writeUInt32LE(blobs[i].length, entry + 8);
      header.writeUInt32LE(offset, entry + 12);
      offset += blobs[i].length;
      chunks.push(blobs[i]);
    });
    fs.writeFileSync(path.join(ICONS_DIR, 'dai-miner.ico'), Buffer.concat(chunks));
    console.log('   ✓ dai-miner.ico created (16/32/48/256)');
  } catch (err) {
    console.error('   ✗ Failed to create .ico:', err.message);
  }

  // Generate macOS .icns
  // Note: Proper .icns generation on Linux is complex.
  // We create a high-res PNG that can be converted on macOS using iconutil,
  // and also provide a 1024px PNG as fallback.
  console.log('\n→ Preparing macOS icon assets...');
  
  // Create iconset folder structure (for macOS iconutil)
  const iconsetDir = path.join(ICONS_DIR, 'dai-miner.iconset');
  if (fs.existsSync(iconsetDir)) {
    fs.rmSync(iconsetDir, { recursive: true });
  }
  fs.mkdirSync(iconsetDir);

  const iconsetSizes = [
    { size: 16, scale: 1 },
    { size: 16, scale: 2 },
    { size: 32, scale: 1 },
    { size: 32, scale: 2 },
    { size: 128, scale: 1 },
    { size: 128, scale: 2 },
    { size: 256, scale: 1 },
    { size: 256, scale: 2 },
    { size: 512, scale: 1 },
    { size: 512, scale: 2 },
  ];

  for (const { size, scale } of iconsetSizes) {
    const actualSize = size * scale;
    const filename = `icon_${size}x${size}${scale > 1 ? '@2x' : ''}.png`;
    const outputPath = path.join(iconsetDir, filename);

    await sharp(SRC_PATH)
      .resize(actualSize, actualSize)
      .png()
      .toFile(outputPath);
  }

  console.log('   ✓ dai-miner.iconset folder created (for macOS)');

  // Also keep a clean 1024px PNG (useful for many purposes)
  await sharp(SRC_PATH)
    .resize(1024, 1024)
    .png()
    .toFile(path.join(ICONS_DIR, 'dai-miner-1024.png'));
  console.log('   ✓ dai-miner-1024.png (high-res fallback)');

  // Create a simple README for icons
  const readme = `# Icons

This folder contains icons generated from the DAI wordmark (\`dai-miner-source.png\`).

## Files

- \`dai-miner-source.png\` — Canonical logo (edit / replace this for design changes)
- \`dai-miner.svg\` — PNG-backed SVG for landing / in-app use
- \`dai-miner-*.png\` — Raster versions in various sizes
- \`dai-miner.ico\` — Windows icon
- \`dai-miner.iconset/\` — macOS iconset (convert to .icns on macOS)

## How to generate .icns (macOS only)

On a Mac, run:

\`\`\`bash
iconutil -c icns assets/icons/dai-miner.iconset -o assets/icons/dai-miner.icns
\`\`\`

Then delete the .iconset folder if desired.

## Regenerating icons

After replacing \`dai-miner-source.png\`, run:

\`\`\`bash
node scripts/generate-icons.js
\`\`\`
`;

  fs.writeFileSync(path.join(ICONS_DIR, 'README.md'), readme);

  console.log('\n✅ Icon generation complete!');
  console.log('\nGenerated files:');
  console.log('  - PNGs in multiple sizes');
  console.log('  - dai-miner.ico (Windows)');
  console.log('  - dai-miner.iconset/ (ready for macOS .icns conversion)');
  console.log('\nNote: For best macOS results, run the iconutil command above on a Mac.');
}

generateIcons().catch(err => {
  console.error('Icon generation failed:', err);
  process.exit(1);
});
