// NaraVisi · extension/offscreen/deteksi-objek.js
// Fungsi   : Deteksi objek lokal dengan MediaPipe Tasks Vision (ObjectDetector, EfficientDet-Lite0 int8).
//            Berjalan di dokumen offscreen (bukan di halaman web). Semua berkas (.mjs, .wasm, .tflite) ada di
//            extension/vendor/, tidak ada yang diunduh dari internet: gratis, offline, tidak memakai kuota.
// Kebutuhan: PF-05
// Terkait  : offscreen.js (penerima pesan), shared/deteksi.js, shared/label-id.json, background.js (detectObjects)

import { gabungkanObjek, kalimatObjek, SKOR_MIN } from '../shared/deteksi.js';

const VENDOR = '../vendor/mediapipe';
const MODEL_URL = new URL('../vendor/models/efficientdet_lite0_int8.tflite', import.meta.url).href;
const MAKS_HASIL = 20; // kotak terbanyak yang diminta dari model per gambar

let siap = null; // Promise<{ detector, kamus }> — dibuat sekali, dipakai ulang

// [PF-05] Deteksi objek lokal — memuat model sekali (lazy) saat pertama dibutuhkan, lalu dipakai ulang
function muatDetektor() {
  siap ??= (async () => {
    const t0 = performance.now();
    // Diimpor dinamis: ~10 MB wasm baru dibaca saat deteksi pertama, bukan saat dokumen offscreen dibuat.
    const { ObjectDetector } = await import(`${VENDOR}/vision_bundle.mjs`);
    // Fileset ditulis langsung (bukan FilesetResolver) agar hanya varian SIMD yang perlu disertakan;
    // Chrome ≥ 91 mendukung WebAssembly SIMD dan manifest mensyaratkan Chrome ≥ 116.
    const fileset = {
      wasmLoaderPath: new URL(`${VENDOR}/wasm/vision_wasm_internal.js`, import.meta.url).href,
      wasmBinaryPath: new URL(`${VENDOR}/wasm/vision_wasm_internal.wasm`, import.meta.url).href,
    };
    const [detector, kamus] = await Promise.all([
      ObjectDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
        runningMode: 'IMAGE',
        scoreThreshold: SKOR_MIN,
        maxResults: MAKS_HASIL,
      }),
      fetch(new URL('../shared/label-id.json', import.meta.url)).then((r) => r.json()),
    ]);
    return { detector, kamus, muatMs: Math.round(performance.now() - t0) };
  })().catch((err) => {
    siap = null; // gagal memuat → coba lagi pada permintaan berikutnya
    throw err;
  });
  return siap;
}

// [PF-05] Deteksi objek lokal — mendeteksi objek pada gambar yang sudah dinormalisasi service worker
/**
 * @param {string} dataUrl  gambar (JPEG/PNG/WebP/GIF) dari service worker, sudah ≤ 1280 px
 * @returns {Promise<{objek: Array<{nama, jumlah, skor}>, kalimat: string, ms: number, muatMs: number}>}
 */
export async function deteksiObjek(dataUrl) {
  const { detector, kamus, muatMs } = await muatDetektor();
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  try {
    const t0 = performance.now();
    const hasil = detector.detect(bitmap);
    const ms = Math.round(performance.now() - t0);
    const mentah = (hasil.detections ?? []).map((d) => ({
      label: d.categories?.[0]?.categoryName ?? '',
      score: d.categories?.[0]?.score ?? 0,
    }));
    const objek = gabungkanObjek(mentah, kamus);
    return { objek, kalimat: kalimatObjek(objek), ms, muatMs };
  } finally {
    bitmap.close();
  }
}
