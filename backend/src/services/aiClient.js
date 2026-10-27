import { Errors } from '../lib/errors.js';

const str = (v) => (typeof v === 'string' ? v : '');

/**
 * Klien HTTP ke layanan AI Image Captioning (FastAPI).
 * fetchImpl dapat diganti saat pengujian.
 */
export function createAiClient({ baseUrl, timeoutMs, fetchImpl = globalThis.fetch }) {
  async function caption({ imageBase64, lang, context }) {
    let response;
    try {
      response = await fetchImpl(`${baseUrl}/caption`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image_base64: imageBase64, lang, ...(context ? { context } : {}) }),
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
      const code = data?.detail?.code;
      if (code === 'MODEL_SAFETY') throw Errors.aiBlocked();
      if (response.status === 429 || code === 'MODEL_BUSY') throw Errors.aiBusy();
      if (response.status === 504) throw Errors.aiTimeout();
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
      // Field terstruktur (ADR-22); null/kosong bila layanan AI versi lama atau provider BLIP.
      jenis: str(data.jenis) || null,
      ringkasan: str(data.ringkasan),
      detail: str(data.detail),
      teksDalamGambar: str(data.teks_dalam_gambar),
      keyakinan: str(data.keyakinan) || null,
      provider: str(data.provider) || null,
      fallback: data.fallback === true,
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
