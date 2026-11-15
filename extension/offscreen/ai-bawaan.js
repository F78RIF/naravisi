// NaraVisi · extension/offscreen/ai-bawaan.js
// Fungsi   : Cadangan offline pertama memakai AI bawaan Chrome (Prompt API / Gemini Nano) bila tersedia di Chrome
//            pengguna dan mendukung input gambar. Deteksi fitur aman: API ada? input gambar didukung? model SUDAH
//            terunduh? Bahasa Indonesia tidak didukung → jawab bahasa Inggris lalu diterjemahkan Translator bawaan
//            Chrome (juga lokal). NaraVisi tidak pernah memicu unduhan model Chrome. Tidak tersedia → dilewati diam-diam.
// Kebutuhan: PF-11
// Terkait  : offscreen.js (pesan NV_AI_BAWAAN_*), shared/deskripsi-ai.js, background.js (cadanganPerangkat)

import { INSTRUKSI, INSTRUKSI_EN, promptPengguna, SKEMA, susunTeks, uraiJawaban } from '../shared/deskripsi-ai.js';

export const BATAS_AI_BAWAAN_MS = 20000;

const opsiSesi = (bahasa) => ({
  expectedInputs: [{ type: 'image' }, { type: 'text', languages: [bahasa] }],
  expectedOutputs: [{ type: 'text', languages: [bahasa] }],
});

async function cekLanguageModel(bahasa) {
  try {
    return await globalThis.LanguageModel.availability(opsiSesi(bahasa));
  } catch {
    return 'unavailable'; // bahasa / jenis input tidak dikenali versi Chrome ini
  }
}

async function cekPenerjemah() {
  try {
    if (!globalThis.Translator) return 'unavailable';
    return await globalThis.Translator.availability({ sourceLanguage: 'en', targetLanguage: 'id' });
  } catch {
    return 'unavailable';
  }
}

// [PF-11] Chrome Built-in AI — status: tersedia / tidak tersedia (+ alasan singkat untuk halaman Pengaturan)
/** @returns {Promise<{tersedia: boolean, alasan: string, bahasa?: 'id'|'en'}>} */
export async function statusAiBawaan() {
  if (typeof globalThis.LanguageModel?.availability !== 'function') return { tersedia: false, alasan: 'Prompt API tidak ada di Chrome ini' };
  let bahasa = 'id';
  let a = await cekLanguageModel('id');
  if (a === 'unavailable') {
    bahasa = 'en';
    a = await cekLanguageModel('en');
  }
  if (a === 'unavailable') return { tersedia: false, alasan: 'model tidak mendukung gambar' };
  if (a === 'downloadable' || a === 'downloading') return { tersedia: false, alasan: 'model AI Chrome belum diunduh oleh Chrome' };
  if (a !== 'available') return { tersedia: false, alasan: `status ${a}` };
  if (bahasa === 'en' && (await cekPenerjemah()) !== 'available') {
    return { tersedia: false, alasan: 'penerjemah bahasa Indonesia bawaan Chrome belum tersedia' };
  }
  return { tersedia: true, alasan: 'siap', bahasa };
}

async function terjemahkan(teks, penerjemah) {
  return teks ? (await penerjemah.translate(teks)).trim() : '';
}

// [PF-11] Chrome Built-in AI — deskripsi satu gambar dengan instruksi yang sama seperti Gemini (batas 20 detik)
/** @returns {Promise<{teks: string, data: object, bahasa: string, ms: number} | null>} null = tidak tersedia */
export async function deskripsiAiBawaan(dataUrl, konteks, { batasMs = BATAS_AI_BAWAAN_MS } = {}) {
  const status = await statusAiBawaan();
  if (!status.tersedia) return null;
  const t0 = performance.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), batasMs);
  let sesi;
  let penerjemah;
  try {
    const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
    sesi = await globalThis.LanguageModel.create({
      ...opsiSesi(status.bahasa),
      initialPrompts: [{ role: 'system', content: status.bahasa === 'id' ? INSTRUKSI : INSTRUKSI_EN }],
      signal: ctrl.signal,
    });
    const jawaban = await sesi.prompt(
      [{ role: 'user', content: [{ type: 'text', value: promptPengguna(konteks) }, { type: 'image', value: bitmap }] }],
      { responseConstraint: SKEMA, signal: ctrl.signal },
    );
    bitmap.close();
    const data = uraiJawaban(jawaban);
    if (!data) return null;
    if (status.bahasa === 'en') {
      penerjemah = await globalThis.Translator.create({ sourceLanguage: 'en', targetLanguage: 'id', signal: ctrl.signal });
      data.ringkasan = await terjemahkan(data.ringkasan, penerjemah);
      data.detail = await terjemahkan(data.detail, penerjemah);
    }
    const teks = susunTeks(data);
    return teks ? { teks, data, bahasa: status.bahasa, ms: Math.round(performance.now() - t0) } : null;
  } finally {
    clearTimeout(timer);
    sesi?.destroy?.();
    penerjemah?.destroy?.();
  }
}
