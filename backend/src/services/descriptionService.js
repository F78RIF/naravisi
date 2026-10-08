import { Errors } from '../lib/errors.js';
import { decodeImagePayload } from '../lib/image.js';

export const SUPPORTED_LANGS = ['id', 'en'];

/**
 * UC-GBR-04 Mengirim Gambar ke AI + UC-GBR-05 Menghasilkan Deskripsi + UC-RWY-01 Menyimpan Riwayat.
 * Urutan: validasi gambar → cek & pesan kuota → AI → simpan riwayat.
 * Bila AI gagal, kuota dikembalikan.
 * File gambar TIDAK disimpan (RNF-13 / ADR-14).
 */
export function createDescriptionService({ aiClient, maxImageBytes, quota, history, subscriptions }) {
  async function describe(body, user) {
    if (!body || typeof body !== 'object') {
      throw Errors.invalidRequest('Badan permintaan harus berupa JSON.');
    }

    const lang = body.lang ?? 'id';
    if (!SUPPORTED_LANGS.includes(lang)) {
      throw Errors.invalidRequest(`Bahasa "${lang}" tidak didukung. Pilihan: ${SUPPORTED_LANGS.join(', ')}.`);
    }

    const pageUrl = typeof body.page_url === 'string' ? body.page_url.slice(0, 2048) : null;
    const imageUrl = typeof body.image_url === 'string' ? body.image_url.slice(0, 2048) : null;
    const image = decodeImagePayload(body.image_base64, { maxBytes: maxImageBytes });

    const unlimited = user ? user.peran === 'admin' || (await subscriptions.isPremium(user.id)) : true;
    const reservation = user ? await quota.reserve(user.id, unlimited) : null;

    const started = performance.now();
    let result;
    try {
      result = await aiClient.caption({ imageBase64: image.base64, lang });
    } catch (err) {
      await reservation?.release();
      throw err;
    }

    const riwayatId = user
      ? await history.save(user.id, { urlHalaman: pageUrl, urlGambar: imageUrl, teks: result.text })
      : null;

    return {
      riwayat_id: riwayatId,
      text: result.text,
      text_en: result.textEn,
      lang: result.lang,
      model: result.model,
      image_mime: image.mime,
      image_bytes: image.buffer.length,
      page_url: pageUrl,
      image_url: imageUrl,
      latency_ms: Math.round(performance.now() - started),
      kuota: user ? await quota.summary(user.id, unlimited) : null,
    };
  }

  return { describe };
}
