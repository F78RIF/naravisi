// NaraVisi · extension/offscreen/baca-teks.js
// Fungsi   : Membaca teks di gambar secara lokal dengan Tesseract.js (bahasa ind + eng, data "fast"). Worker, inti wasm,
//            dan data bahasa ada di extension/vendor (tanpa CDN); worker berjalan dari dokumen offscreen. Dimuat sekali
//            (lazy), batas waktu 4 detik per gambar. Tidak ada gambar yang dikirim ke server.
// Kebutuhan: PF-06
// Terkait  : offscreen.js (penerima pesan NV_READ_TEXT), shared/ocr.js (penyaringan & kalimat), background.js

import { barisDariTesseract, kalimatTulisan, rapikanTeks } from '../shared/ocr.js';

const VENDOR = new URL('../vendor/', import.meta.url).href;
export const BATAS_OCR_MS = 4000;
const OEM_LSTM = 1; // data "fast" hanya berisi model LSTM

let siap = null; // Promise<{ worker, muatMs }> — dibuat sekali, dipakai ulang

// [PF-06] Teks di gambar (OCR) — memuat Tesseract sekali (lazy); semua jalur menunjuk berkas lokal extension
function muatOcr() {
  siap ??= (async () => {
    const t0 = performance.now();
    const { default: Tesseract } = await import(`${VENDOR}tesseract/tesseract.esm.min.js`);
    const worker = await Tesseract.createWorker(['ind', 'eng'], OEM_LSTM, {
      workerPath: `${VENDOR}tesseract/worker.min.js`,
      corePath: `${VENDOR}tesseract/tesseract-core-simd-lstm.js`, // satu varian saja (SIMD; Chrome ≥ 116)
      langPath: `${VENDOR}tessdata`, // ind.traineddata.gz, eng.traineddata.gz (tessdata_fast 4.1.0)
      gzip: true,
      workerBlobURL: false, // worker dimuat langsung dari berkas extension (CSP MV3)
      cacheMethod: 'none', // data sudah lokal; tidak perlu disalin ke IndexedDB
      logger: () => {},
      errorHandler: () => {},
    });
    return { worker, muatMs: Math.round(performance.now() - t0) };
  })().catch((err) => {
    siap = null; // gagal memuat (mis. data bahasa belum ada) → fitur diam, dicoba lagi lain kali
    throw err;
  });
  return siap;
}

/** Hentikan worker yang macet agar permintaan berikutnya tidak mengantre di belakangnya. */
async function hentikan() {
  const lama = siap;
  siap = null;
  try {
    (await lama)?.worker?.terminate();
  } catch {
    /* sudah mati */
  }
}

// [PF-06] Teks di gambar (OCR) — memanaskan Tesseract saat panel dibuka, supaya Enter pertama tidak menunggu muat
export function panaskanOcr() {
  return muatOcr().then(() => true, () => false);
}

// [PF-06] Teks di gambar (OCR) — membaca teks; > 4 detik → dibatalkan (tidak ada teks yang dibacakan)
/**
 * @param {string} dataUrl  gambar ≤ 1280 px dari service worker
 * @returns {Promise<{teks: string|null, terpotong: boolean, kalimat: string|null, kata: number, ms: number,
 *   muatMs: number, waktuHabis?: boolean}>}
 */
export async function bacaTeks(dataUrl, { batasMs = BATAS_OCR_MS } = {}) {
  const { worker, muatMs } = await muatOcr();
  const blob = await (await fetch(dataUrl)).blob();
  const t0 = performance.now();
  let timer;
  const habis = new Promise((resolve) => { timer = setTimeout(resolve, batasMs, null); });
  const data = await Promise.race([worker.recognize(blob, {}, { blocks: true, text: false }).then((r) => r.data), habis]);
  clearTimeout(timer);
  const ms = Math.round(performance.now() - t0);
  if (!data) {
    await hentikan();
    return { teks: null, terpotong: false, kalimat: null, kata: 0, ms, muatMs, waktuHabis: true };
  }
  const hasil = rapikanTeks(barisDariTesseract(data));
  return { teks: hasil?.teks ?? null, terpotong: Boolean(hasil?.terpotong), kalimat: kalimatTulisan(hasil), kata: hasil?.kata ?? 0, ms, muatMs };
}
