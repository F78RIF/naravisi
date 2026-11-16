// NaraVisi · scripts/salin-vendor.mjs
// Fungsi   : Satu perintah untuk mengisi extension/vendor/ dari e2e/node_modules (`npm run vendor`): MediaPipe (PF-05),
//            jsQR (PF-07), Tesseract.js + inti wasm (PF-06), Transformers.js + wasm ONNX Runtime (PF-10). Pustaka hasil
//            build pihak ketiga ini TIDAK masuk git (.gitignore); hanya data yang bukan dari npm (model EfficientDet,
//            data bahasa tessdata) yang dilacak. Dijalankan otomatis oleh `npm run build:extension` dan sebelum tes e2e.
// Kebutuhan: PF-05, PF-06, PF-07, PF-10
// Terkait  : scripts/salin-mediapipe.mjs, scripts/salin-lapis-lokal.mjs, package.json, e2e/package.json, .gitignore
// Pemakaian: npm install && npm run vendor        (dari folder repo)

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (!existsSync(path.join(ROOT, 'e2e/node_modules'))) {
  console.error('e2e/node_modules belum ada. Jalankan dulu: npm install  (dari folder repo)');
  process.exit(1);
}

for (const skrip of ['salin-mediapipe.mjs', 'salin-lapis-lokal.mjs']) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', skrip), ...process.argv.slice(2)], { stdio: 'inherit', cwd: ROOT });
  if (r.status !== 0) {
    console.error(`Gagal: scripts/${skrip} (kode ${r.status ?? r.signal})`);
    process.exit(r.status || 1);
  }
}
console.log('extension/vendor/ siap.');
