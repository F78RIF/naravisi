// NaraVisi · scripts/salin-lapis-lokal.mjs
// Fungsi   : Menyalin pustaka lapis lokal ke extension/vendor (MV3 melarang memuat skrip/wasm/data dari internet):
//            jsQR (PF-07), Tesseract.js + inti wasm SIMD-LSTM (PF-06) dari e2e/node_modules, dan data bahasa
//            "fast" ind + eng dari repo resmi tesseract-ocr/tessdata_fast (tag 4.1.0), lalu memeriksa SHA-256-nya.
// Kebutuhan: PF-06, PF-07
// Terkait  : e2e/package.json (jsqr, tesseract.js, tesseract.js-core), offscreen/kode-qr.js, offscreen/baca-teks.js,
//            THIRD_PARTY_NOTICES.md
// Pemakaian: cd e2e && npm install && cd .. && node scripts/salin-lapis-lokal.mjs
//
// Bila unduhan data bahasa gagal, unduh manual dari URL_DATA di bawah (eng.traineddata dan ind.traineddata), simpan di
// folder mana saja, lalu jalankan:  node scripts/salin-lapis-lokal.mjs --dari <folder>
// Tanpa data bahasa, fitur "Baca tulisan di gambar" nonaktif dengan aman (tidak ada yang dibacakan).

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NM = path.join(ROOT, 'e2e/node_modules');
const VENDOR = path.join(ROOT, 'extension/vendor');
const URL_DATA = 'https://github.com/tesseract-ocr/tessdata_fast/raw/4.1.0';
// SHA-256 berkas .traineddata (belum dikompres) dari tessdata_fast tag 4.1.0.
const DATA_SHA256 = {
  eng: '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2',
  ind: '69786901da87ab8766c1ea7fbb10b28f2110c14da3f6c8f2735df131fba95d88',
};

// [PF-07] Kode QR & barcode — jsQR (cadangan bila BarcodeDetector tidak ada, mis. Chrome di Windows)
// [PF-06] Teks di gambar (OCR) — Tesseract.js: API + worker + satu inti wasm (SIMD, khusus LSTM; Chrome ≥ 116)
const SALIN = [
  ['jsqr/dist/jsQR.js', 'jsqr/jsQR.js'],
  ['jsqr/LICENSE', 'jsqr/LICENSE'],
  ['tesseract.js/dist/tesseract.esm.min.js', 'tesseract/tesseract.esm.min.js'],
  ['tesseract.js/dist/worker.min.js', 'tesseract/worker.min.js'],
  ['tesseract.js/LICENSE.md', 'tesseract/LICENSE.md'],
  ['tesseract.js-core/tesseract-core-simd-lstm.js', 'tesseract/tesseract-core-simd-lstm.js'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm', 'tesseract/tesseract-core-simd-lstm.wasm'],
  ['tesseract.js-core/LICENSE', 'tesseract/LICENSE-tesseract.js-core'],
];

const versi = (p) => JSON.parse(readFileSync(path.join(NM, p, 'package.json'), 'utf8')).version;
let gagal = false;
for (const [dari, ke] of SALIN) {
  const sumber = path.join(NM, dari);
  if (!existsSync(sumber)) {
    // LICENSE bisa bernama lain antarversi; berkas lain wajib ada.
    if (/LICENSE/.test(dari)) continue;
    console.error(`Tidak ditemukan: ${sumber}\nJalankan dulu: cd e2e && npm install`);
    process.exit(1);
  }
  mkdirSync(path.dirname(path.join(VENDOR, ke)), { recursive: true });
  copyFileSync(sumber, path.join(VENDOR, ke));
}
console.log(`jsQR ${versi('jsqr')}, Tesseract.js ${versi('tesseract.js')}, inti ${versi('tesseract.js-core')} disalin ke extension/vendor`);

const dariFolder = process.argv.includes('--dari') ? process.argv[process.argv.indexOf('--dari') + 1] : null;
mkdirSync(path.join(VENDOR, 'tessdata'), { recursive: true });
for (const [bahasa, sha] of Object.entries(DATA_SHA256)) {
  const tujuan = path.join(VENDOR, `tessdata/${bahasa}.traineddata.gz`);
  let mentah = existsSync(tujuan) ? gunzipSync(readFileSync(tujuan)) : null;
  if (!mentah && dariFolder) mentah = readFileSync(path.join(dariFolder, `${bahasa}.traineddata`));
  if (!mentah) {
    try {
      const res = await fetch(`${URL_DATA}/${bahasa}.traineddata`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      mentah = Buffer.from(await res.arrayBuffer());
    } catch (err) {
      console.error(`Gagal mengunduh ${bahasa}.traineddata (${err.message}).\nUnduh manual: ${URL_DATA}/${bahasa}.traineddata`);
      gagal = true;
      continue;
    }
  }
  const cek = createHash('sha256').update(mentah).digest('hex');
  if (cek !== sha) {
    console.error(`SHA-256 ${bahasa}.traineddata tidak cocok (${cek}). Hapus ${tujuan} lalu unduh ulang.`);
    gagal = true;
    continue;
  }
  if (!existsSync(tujuan)) writeFileSync(tujuan, gzipSync(mentah, { level: 9 }));
  console.log(`Data bahasa ${bahasa} (tessdata_fast 4.1.0) ada dan SHA-256 cocok.`);
}
process.exit(gagal ? 1 : 0);
