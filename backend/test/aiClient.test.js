import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createAiClient } from '../src/services/aiClient.js';
import { fakeResponse } from './helpers.js';

function clientWith(fetchImpl) {
  return createAiClient({ baseUrl: 'http://ai.test', timeoutMs: 1000, fetchImpl });
}

describe('aiClient.caption', () => {
  it('mengirim gambar dan bahasa, lalu memetakan respons', async () => {
    let captured;
    const client = clientWith(async (url, init) => {
      captured = { url, body: JSON.parse(init.body) };
      return fakeResponse(200, { text: ' Seekor anjing. ', text_en: 'a dog', lang: 'id', model: 'blip', latency_ms: 900 });
    });
    const out = await client.caption({ imageBase64: 'AAAA', lang: 'id' });
    assert.equal(captured.url, 'http://ai.test/caption');
    assert.deepEqual(captured.body, { image_base64: 'AAAA', lang: 'id' });
    assert.deepEqual(out, {
      text: 'Seekor anjing.', textEn: 'a dog', lang: 'id', model: 'blip', latencyMs: 900,
      jenis: null, ringkasan: '', detail: '', teksDalamGambar: '', keyakinan: null, provider: null, fallback: false,
    });
  });

  it('Tahap 1: meneruskan petunjuk halaman dan memetakan field terstruktur Gemini', async () => {
    let captured;
    const client = clientWith(async (url, init) => {
      captured = JSON.parse(init.body);
      return fakeResponse(200, {
        text: 'Grafik: Penjualan naik.', text_en: '', lang: 'id', model: 'flash', latency_ms: 800,
        jenis: 'grafik', ringkasan: 'Penjualan naik.', detail: 'Batang biru.', teks_dalam_gambar: 'Q1\nQ2',
        keyakinan: 'tinggi', provider: 'gemini', fallback: false,
      });
    });
    const out = await client.caption({ imageBase64: 'AAAA', lang: 'id', context: { caption: 'Penjualan 2026' } });
    assert.deepEqual(captured.context, { caption: 'Penjualan 2026' });
    assert.equal(out.jenis, 'grafik');
    assert.equal(out.teksDalamGambar, 'Q1\nQ2');
    assert.equal(out.provider, 'gemini');
  });

  it('Tahap 1: filter keamanan → AI_BLOCKED 422; sibuk/kuota Gemini → AI_BUSY 503 (bukan 500)', async () => {
    const blocked = clientWith(async () => fakeResponse(422, { detail: { code: 'MODEL_SAFETY', message: 'ditahan' } }));
    await assert.rejects(blocked.caption({ imageBase64: 'AAAA', lang: 'id' }), { code: 'AI_BLOCKED', status: 422 });
    const busy = clientWith(async () => fakeResponse(429, { detail: { code: 'MODEL_BUSY', message: 'sibuk' } }));
    await assert.rejects(busy.caption({ imageBase64: 'AAAA', lang: 'id' }), { code: 'AI_BUSY', status: 503 });
    const slow = clientWith(async () => fakeResponse(504, { detail: { code: 'MODEL_TIMEOUT', message: 'lama' } }));
    await assert.rejects(slow.caption({ imageBase64: 'AAAA', lang: 'id' }), { code: 'AI_TIMEOUT', status: 504 });
  });

  it('AI_UNAVAILABLE saat koneksi gagal', async () => {
    const client = clientWith(async () => {
      throw new TypeError('fetch failed');
    });
    await assert.rejects(client.caption({ imageBase64: 'AAAA', lang: 'id' }), { code: 'AI_UNAVAILABLE', status: 503 });
  });

  it('AI_TIMEOUT saat waktu habis', async () => {
    const client = clientWith(async () => {
      const err = new Error('timeout');
      err.name = 'TimeoutError';
      throw err;
    });
    await assert.rejects(client.caption({ imageBase64: 'AAAA', lang: 'id' }), { code: 'AI_TIMEOUT', status: 504 });
  });

  it('AI_FAILED membawa pesan dari layanan AI untuk gambar tak terbaca', async () => {
    const client = clientWith(async () =>
      fakeResponse(415, { detail: { code: 'IMAGE_UNREADABLE', message: 'Gambar tidak dapat dibuka.' } }),
    );
    await assert.rejects(client.caption({ imageBase64: 'AAAA', lang: 'id' }), {
      code: 'AI_FAILED',
      message: 'Gambar tidak dapat dibuka.',
    });
  });

  it('AI_FAILED bila deskripsi kosong', async () => {
    const client = clientWith(async () => fakeResponse(200, { text: '   ' }));
    await assert.rejects(client.caption({ imageBase64: 'AAAA', lang: 'id' }), { code: 'AI_FAILED' });
  });

  it('AI_UNAVAILABLE saat layanan AI 503 (model belum siap)', async () => {
    const client = clientWith(async () => fakeResponse(503, { detail: 'loading' }));
    await assert.rejects(client.caption({ imageBase64: 'AAAA', lang: 'id' }), { code: 'AI_UNAVAILABLE' });
  });
});

describe('aiClient.health', () => {
  it('ok:false saat layanan AI mati', async () => {
    const client = clientWith(async () => {
      throw new TypeError('fetch failed');
    });
    assert.deepEqual(await client.health(), { ok: false });
  });
});
