// Membuat ikon PNG extension (16/32/48/128 px) dari SVG logo NaraVisi.
// Jalankan: cd e2e && npm run icons
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const iconsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../extension/icons');
const SOURCES = { 16: 'icon-16.svg', 32: 'icon-32.svg', 48: 'icon.svg', 128: 'icon.svg' };

for (const [size, file] of Object.entries(SOURCES)) {
  const out = path.join(iconsDir, `icon${size}.png`);
  await sharp(path.join(iconsDir, file), { density: 72 * (Number(size) / 16) * 4 })
    .resize(Number(size), Number(size))
    .png()
    .toFile(out);
  console.log(`  ✔ ${path.relative(process.cwd(), out)}`);
}
