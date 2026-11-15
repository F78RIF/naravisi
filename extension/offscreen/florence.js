// NaraVisi · extension/offscreen/florence.js
// Fungsi   : Deskripsi offline lengkap dengan Florence-2 (base) lewat Transformers.js: keterangan rinci
//            (<MORE_DETAILED_CAPTION>) + tulisan (<OCR>), lalu diterjemahkan ke bahasa Indonesia oleh opus-mt-en-id.
//            Berjalan di dokumen offscreen, WebGPU bila ada, WASM bila tidak, dengan batas waktu. Bobot hanya diunduh
//            setelah pengguna menyetujui (unduhFlorence dengan izin); pemakaian biasa tidak pernah mengunduh.
// Kebutuhan: PF-10
// Terkait  : offscreen/model-offline.js, shared/deskripsi-ai.js, shared/ocr.js, offscreen.js, background.js

import { bersihkanKeteranganEn, susunFlorence } from '../shared/deskripsi-ai.js';
import { kataBermakna } from '../shared/ocr.js';
import { denganIzin, PAKET, pelacakProgres, pilihPerangkat } from './model-offline.js';

export const BATAS_FLORENCE_MS = 60000;
const [FLORENCE, PENERJEMAH] = PAKET.florence.model;

let siap = null; // Promise<{ model, processor, terjemah, perangkat, muatMs }>

function muat({ izinUnduh = false, progres } = {}) {
  if (siap && !izinUnduh) return siap;
  siap = denganIzin(izinUnduh, async (T) => {
    const t0 = performance.now();
    const perangkat = await pilihPerangkat();
    const opsi = { revision: FLORENCE.revisi, progress_callback: progres };
    const [model, processor, terjemah] = await Promise.all([
      T.Florence2ForConditionalGeneration.from_pretrained(FLORENCE.id, { ...opsi, dtype: FLORENCE.dtype, device: perangkat }),
      T.AutoProcessor.from_pretrained(FLORENCE.id, opsi),
      T.pipeline('translation', PENERJEMAH.id, { revision: PENERJEMAH.revisi, dtype: PENERJEMAH.dtype, device: 'wasm', progress_callback: progres }),
    ]);
    return { model, processor, terjemah, perangkat, muatMs: Math.round(performance.now() - t0) };
  }).catch((err) => {
    siap = null;
    throw err;
  });
  return siap;
}

// [PF-10] Florence-2 offline — unduh bobot (hanya dipanggil setelah konfirmasi pengguna yang dibacakan)
export async function unduhFlorence(lapor) {
  const m = await muat({ izinUnduh: true, progres: pelacakProgres('florence', lapor) });
  return { perangkat: m.perangkat, muatMs: m.muatMs };
}

async function jalankan(T, m, image, tugas, maksToken) {
  const visi = await m.processor(image);
  const prompt = m.processor.construct_prompts(tugas);
  const teks = m.processor.tokenizer(prompt);
  const ids = await m.model.generate({ ...teks, ...visi, max_new_tokens: maksToken });
  const mentah = m.processor.batch_decode(ids, { skip_special_tokens: false })[0];
  const hasil = m.processor.post_process_generation(mentah, tugas, image.size);
  return String(hasil?.[tugas] ?? '').trim();
}

// [PF-10] Florence-2 offline — keterangan + tulisan → bahasa Indonesia (batas 60 detik); belum diunduh → galat
/** @returns {Promise<{teks: string, keteranganEn: string, tulisan: string, perangkat: string, ms: number, muatMs: number}>} */
export async function deskripsiFlorence(dataUrl, { batasMs = BATAS_FLORENCE_MS } = {}) {
  let timer;
  const habis = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('FLORENCE_TIMEOUT')), batasMs); });
  try {
    return await Promise.race([habis, (async () => {
      const m = await muat();
      const T = await import(new URL('../vendor/transformers/transformers.min.js', import.meta.url).href);
      const t0 = performance.now();
      const image = await T.RawImage.fromBlob(await (await fetch(dataUrl)).blob());
      const keteranganEn = bersihkanKeteranganEn(await jalankan(T, m, image, '<MORE_DETAILED_CAPTION>', 96));
      const tulisan = await jalankan(T, m, image, '<OCR>', 96);
      const keteranganId = keteranganEn ? (await m.terjemah(keteranganEn, { max_new_tokens: 160 }))[0]?.translation_text ?? '' : '';
      const teks = susunFlorence(keteranganId, tulisan, kataBermakna);
      if (!teks) throw new Error('FLORENCE_KOSONG');
      return { teks, keteranganEn, tulisan, perangkat: m.perangkat, ms: Math.round(performance.now() - t0), muatMs: m.muatMs };
    })()]);
  } finally {
    clearTimeout(timer);
  }
}

/** Lepaskan model dari memori (dipakai saat model dihapus). */
export async function lepasFlorence() {
  const lama = siap;
  siap = null;
  try {
    const m = await lama;
    await m?.model?.dispose?.();
    await m?.terjemah?.dispose?.();
  } catch {
    /* belum dimuat */
  }
}
