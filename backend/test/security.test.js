// Uji hasil perbaikan evaluasi keamanan Fase 7 (E-01..E-03).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { startTestApp } from './support/testApp.js';

describe('Keamanan (Fase 7)', () => {
  let app;
  before(async () => {
    app = await startTestApp();
  });
  after(() => app.close());

  it('E-01: 10 login gagal berturut-turut → dikunci 15 menit, lalu bisa lagi', async () => {
    const u = await app.register();
    for (let i = 0; i < 10; i++) {
      const r = await app.api('POST', '/api/v1/auth/login', { body: { email: u.email, kata_sandi: 'tebakan-salah' } });
      assert.equal(r.status, 401);
    }
    const locked = await app.api('POST', '/api/v1/auth/login', { body: { email: u.email, kata_sandi: u.password } });
    assert.equal(locked.status, 429);
    assert.equal(locked.body.error.code, 'TOO_MANY_ATTEMPTS');
    assert.match(locked.body.error.message, /15 menit/);

    app.clock.advanceDays(16 / (24 * 60)); // maju 16 menit
    const ok = await app.api('POST', '/api/v1/auth/login', { body: { email: u.email, kata_sandi: u.password } });
    assert.equal(ok.status, 200);
  });

  it('E-01: login berhasil mengatur ulang hitungan gagal', async () => {
    const u = await app.register();
    for (let i = 0; i < 9; i++) await app.api('POST', '/api/v1/auth/login', { body: { email: u.email, kata_sandi: 'salah-lagi1' } });
    assert.equal((await app.api('POST', '/api/v1/auth/login', { body: { email: u.email, kata_sandi: u.password } })).status, 200);
    for (let i = 0; i < 9; i++) await app.api('POST', '/api/v1/auth/login', { body: { email: u.email, kata_sandi: 'salah-lagi1' } });
    assert.equal((await app.api('POST', '/api/v1/auth/login', { body: { email: u.email, kata_sandi: u.password } })).status, 200);
  });

  it('E-02: body besar hanya diterima di /descriptions', async () => {
    const big = 'x'.repeat(40 * 1024);
    const login = await app.api('POST', '/api/v1/auth/login', { body: { email: 'a@b.id', kata_sandi: big } });
    assert.equal(login.status, 413);
    assert.equal(login.body.error.code, 'PAYLOAD_TOO_LARGE');

    const u = await app.register();
    const desc = await app.api('POST', '/api/v1/descriptions', { token: u.token, body: { image_base64: 'A'.repeat(40 * 1024) } });
    assert.notEqual(desc.status, 413); // ditolak karena bukan gambar, bukan karena ukuran
    assert.equal(desc.body.error.code, 'IMAGE_UNSUPPORTED');
  });

  it('E-03: halaman HTML membawa Content-Security-Policy & X-Frame-Options', async () => {
    for (const path of ['/admin/', '/pay/finish']) {
      const res = await app.api('GET', path);
      assert.equal(res.status, 200, path);
      assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
      assert.equal(res.headers.get('x-frame-options'), 'DENY');
    }
  });
});
