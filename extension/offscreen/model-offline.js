// NaraVisi · extension/offscreen/model-offline.js
// Fungsi   : Pengelola model offline berbasis Transformers.js (PF-10 Florence-2, PF-12 Whisper). Pustaka & wasm ONNX
//            Runtime dibundel di extension/vendor/transformers (tanpa kode jarak jauh). Yang boleh diunduh hanya DATA
//            (bobot model) dari huggingface.co, hanya bila `izinUnduh` = true (pengguna sudah menyetujui), dengan revisi
//            yang dipatok. Bobot disimpan di Cache API extension ("transformers-cache"), bisa dihapus.
// Kebutuhan: PF-10, PF-12
// Terkait  : shared/paket-model.js, offscreen/florence.js, offscreen/whisper.js, offscreen.js, background.js, pages/pengaturan.js

import { PAKET, ukuranPaketMb } from '../shared/paket-model.js';

export { PAKET, ukuranPaketMb };

const VENDOR = new URL('../vendor/transformers/', import.meta.url).href;
export const NAMA_CACHE = 'transformers-cache';

let pustaka = null;
let izinAktif = false;

// [PF-10] Florence-2 offline — penjaga jaringan: permintaan ke huggingface.co DITOLAK kecuali saat unduhan yang sudah
// diizinkan pengguna. Berkas yang sudah ada di Cache API tetap dibaca tanpa jaringan. Host lain tidak tersentuh.
const HOST_MODEL = /^https:\/\/([a-z0-9-]+\.)*(huggingface\.co|hf\.co)\//i;
const fetchAsli = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input?.url ?? String(input);
  if (HOST_MODEL.test(url) && !izinAktif) return Promise.reject(new Error('MODEL_BELUM_DIUNDUH'));
  return fetchAsli(input, init);
};

// [PF-10] Florence-2 offline — memuat Transformers.js lokal; wasm ORT dari extension, bukan CDN
export function muatTransformers() {
  pustaka ??= import(`${VENDOR}transformers.min.js`).then((T) => {
    T.env.backends.onnx.wasm.wasmPaths = VENDOR; // ort-wasm-simd-threaded.asyncify.{mjs,wasm} lokal, bukan CDN
    T.env.backends.onnx.wasm.proxy = false;
    T.env.allowLocalModels = false;
    T.env.allowRemoteModels = true; // alamat huggingface.co; unduhan sungguhan tetap dijaga penjaga fetch di atas
    T.env.useBrowserCache = true;
    T.env.remoteHost = 'https://huggingface.co/';
    return T;
  }).catch((err) => {
    pustaka = null;
    throw err;
  });
  return pustaka;
}

// [PF-10] Florence-2 offline — WebGPU bila ada, WASM bila tidak
export async function pilihPerangkat() {
  try {
    if (navigator.gpu && (await navigator.gpu.requestAdapter())) return 'webgpu';
  } catch {
    /* tanpa WebGPU */
  }
  return 'wasm';
}

/**
 * Jalankan `fn(T)` dengan izin unduh sesuai `izinUnduh`. Tanpa izin, berkas yang belum ada di cache → galat
 * (tidak pernah mengunduh diam-diam).
 */
export async function denganIzin(izinUnduh, fn) {
  const T = await muatTransformers();
  izinAktif = izinUnduh === true;
  try {
    return await fn(T);
  } finally {
    izinAktif = false;
  }
}

// [PF-10] Florence-2 offline — "Hapus model offline": hapus berkas paket dari Cache API extension
export async function hapusPaket(nama) {
  const cache = await caches.open(NAMA_CACHE);
  let n = 0;
  for (const req of await cache.keys()) {
    if (PAKET[nama].model.some((m) => req.url.includes(`/${m.id}/`))) {
      await cache.delete(req);
      n += 1;
    }
  }
  return n;
}

/** Jumlah berkas & byte paket yang sudah ada di cache (untuk status di Pengaturan). */
export async function isiCache(nama) {
  if (!(await caches.has(NAMA_CACHE))) return { berkas: 0, mb: 0 };
  const cache = await caches.open(NAMA_CACHE);
  let berkas = 0;
  let byte = 0;
  for (const req of await cache.keys()) {
    if (!PAKET[nama].model.some((m) => req.url.includes(`/${m.id}/`))) continue;
    berkas += 1;
    byte += Number((await cache.match(req))?.headers.get('content-length')) || 0;
  }
  return { berkas, mb: Math.round(byte / 1e6) };
}

/** Progres unduhan gabungan (0–100) dari progress_callback Transformers.js. */
export function pelacakProgres(nama, lapor) {
  const total = ukuranPaketMb(nama) * 1e6;
  const per = new Map();
  let terakhir = -1;
  return (e) => {
    if (e?.status !== 'progress' || !e.file) return;
    per.set(`${e.name}/${e.file}`, Number(e.loaded) || 0);
    const persen = Math.min(99, Math.floor(([...per.values()].reduce((a, b) => a + b, 0) / total) * 100));
    if (persen >= terakhir + 5) {
      terakhir = persen;
      lapor(persen);
    }
  };
}
