import { Errors } from '../lib/errors.js';

/**
 * Klien HTTP ke layanan AI Image Captioning (FastAPI).
 * fetchImpl dapat diganti saat pengujian.
 */
export function createAiClient({ baseUrl, timeoutMs, fetchImpl = globalThis.fetch }) {
  async function caption({ imageBase64, lang }) {
    let response;
    try {
      response = await fetchImpl(`${baseUrl}/caption`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image_base64: imageBase64, lang }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') throw Errors.aiTimeout();
      throw Errors.aiUnavailable();
    }

    let data = null;
    try {
      data = await response.json();
    } catch {
      // badan respons bukan JSON
    }

    if (!response.ok) {
      if (response.status === 415 || response.status === 422) {
        throw Errors.aiFailed(data?.detail?.message || 'Layanan AI tidak dapat membaca gambar ini.');
      }
      if (response.status === 503) throw Errors.aiUnavailable();
      throw Errors.aiFailed();
    }

    if (!data || typeof data.text !== 'string' || data.text.trim() === '') {
      throw Errors.aiFailed('Layanan AI tidak menghasilkan deskripsi.');
    }

    return {
      text: data.text.trim(),
      textEn: typeof data.text_en === 'string' ? data.text_en : null,
      lang: data.lang || lang,
      model: data.model || 'unknown',
      latencyMs: Number.isFinite(data.latency_ms) ? data.latency_ms : null,
    };
  }

  async function health() {
    try {
      const response = await fetchImpl(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) return { ok: false };
      return { ok: true, ...(await response.json()) };
    } catch {
      return { ok: false };
    }
  }

  return { caption, health };
}
