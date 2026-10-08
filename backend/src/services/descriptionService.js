import { Errors } from '../lib/errors.js';
import { decodeImagePayload } from '../lib/image.js';

export const SUPPORTED_LANGS = ['id', 'en'];

/**
 * UC-GBR-04 Mengirim Gambar ke AI + UC-GBR-05 Menghasilkan Deskripsi Gambar.
 * Fungsi murni (tanpa Express) agar mudah diuji.
 *
 * Fase 2 akan menambahkan: cek kuota harian (Pengguna Gratis) dan
 * penyimpanan ke riwayat_deskripsi (UC-RWY-01).
 */
export function createDescriptionService({ aiClient, maxImageBytes }) {
  async function describe(body) {
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
    const started = performance.now();
    const result = await aiClient.caption({ imageBase64: image.base64, lang });

    return {
      text: result.text,
      text_en: result.textEn,
      lang: result.lang,
      model: result.model,
      image_mime: image.mime,
      image_bytes: image.buffer.length,
      page_url: pageUrl,
      image_url: imageUrl,
      latency_ms: Math.round(performance.now() - started),
    };
  }

  return { describe };
}
