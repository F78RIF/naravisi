// NaraVisi · scripts/salin-mediapipe.mjs
// Fungsi   : Menyalin MediaPipe Tasks Vision dari e2e/node_modules ke extension/vendor/mediapipe dan mengunduh
//            model EfficientDet-Lite0 (int8) ke extension/vendor/models, lalu memeriksa SHA-256 model.
//            Extension MV3 tidak boleh memuat skrip/model dari internet, jadi semuanya disimpan lokal.
// Kebutuhan: PF-05
// Terkait  : e2e/package.json (@mediapipe/tasks-vision), extension/offscreen/deteksi-objek.js, THIRD_PARTY_NOTICES.md
// Pemakaian: cd e2e && npm install && cd .. && node scripts/salin-mediapipe.mjs
//
// Bila unduhan model gagal, unduh manual dari MODEL_URL di bawah dan simpan sebagai
// extension/vendor/models/efficientdet_lite0_int8.tflite, lalu jalankan skrip ini lagi untuk memeriksanya.

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAKET = path.join(ROOT, 'e2e/node_modules/@mediapipe/tasks-vision');
const VENDOR = path.join(ROOT, 'extension/vendor');
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite';
const MODEL_FILE = path.join(VENDOR, 'models/efficientdet_lite0_int8.tflite');
const MODEL_SHA256 = '0720bf247bd76e6594ea28fa9c6f7c5242be774818997dbbeffc4da460c723bb';

// [PF-05] Deteksi objek lokal — hanya varian SIMD yang disalin (Chrome ≥ 116 mendukung WebAssembly SIMD)
const SALIN = ['vision_bundle.mjs', 'wasm/vision_wasm_internal.js', 'wasm/vision_wasm_internal.wasm'];

if (!existsSync(PAKET)) {
  console.error('Paket belum terpasang. Jalankan dulu: cd e2e && npm install');
  process.exit(1);
}
const versi = JSON.parse(readFileSync(path.join(PAKET, 'package.json'), 'utf8')).version;
for (const f of SALIN) {
  mkdirSync(path.dirname(path.join(VENDOR, 'mediapipe', f)), { recursive: true });
  copyFileSync(path.join(PAKET, f), path.join(VENDOR, 'mediapipe', f));
}
console.log(`MediaPipe Tasks Vision ${versi} disalin ke extension/vendor/mediapipe`);

if (!existsSync(MODEL_FILE)) {
  mkdirSync(path.dirname(MODEL_FILE), { recursive: true });
  try {
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    writeFileSync(MODEL_FILE, Buffer.from(await res.arrayBuffer()));
  } catch (err) {
    console.error(`Gagal mengunduh model (${err.message}).\nUnduh manual: ${MODEL_URL}\nSimpan sebagai: ${MODEL_FILE}`);
    process.exit(1);
  }
}
const sha = createHash('sha256').update(readFileSync(MODEL_FILE)).digest('hex');
if (sha !== MODEL_SHA256) {
  console.error(`SHA-256 model tidak cocok (${sha}). Hapus berkasnya lalu unduh ulang dari ${MODEL_URL}`);
  process.exit(1);
}
console.log('Model EfficientDet-Lite0 (int8) ada dan SHA-256 cocok.');
