// Uji integrasi HTTP. Membutuhkan `npm install` (Express) — dilewati bila belum terpasang.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { fakeAiClient, PNG_1PX_BASE64 } from './helpers.js';

let createApp = null;
try {
  ({ createApp } = await import('../src/app.js'));
} catch {
  createApp = null;
}

describe('REST API /api/v1', { skip: createApp ? false : 'express belum terpasang (jalankan npm install)' }, () => {
  let server;
  let base;

  before(async () => {
    const app = createApp({ aiClient: fakeAiClient(), maxImageBytes: 1024 * 1024 });
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}/api/v1`;
  });
  after(() => server?.close());

  it('GET /health', async () => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, 'ok');
  });

  it('POST /descriptions → 201', async () => {
    const res = await fetch(`${base}/descriptions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image_base64: PNG_1PX_BASE64, page_url: 'https://contoh.id' }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.text, 'Seekor kucing duduk di atas sofa.');
  });

  it('POST /descriptions gambar rusak → 400 dengan pesan Indonesia', async () => {
    const res = await fetch(`${base}/descriptions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image_base64: '###' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, 'IMAGE_INVALID');
  });

  it('JSON rusak → 400 INVALID_REQUEST', async () => {
    const res = await fetch(`${base}/descriptions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{bukan json',
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, 'INVALID_REQUEST');
  });

  it('endpoint tak dikenal → 404 JSON', async () => {
    const res = await fetch(`${base}/tidak-ada`);
    assert.equal(res.status, 404);
  });
});
