import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Errors } from '../src/lib/errors.js';
import { startTestApp } from './support/testApp.js';

describe('Deskripsi + kuota + riwayat (UC-GBR-04/05, UC-RWY-01..04)', () => {
  let app;
  before(async () => {
    app = await startTestApp();
  });
  after(() => app.close());
  beforeEach(() => {
    app.ai.fail = null;
    app.clock.set('2026-10-08T03:00:00Z'); // 11.00 WITA
  });

  it('wajib login', async () => {
    const res = await app.api('POST', '/api/v1/descriptions', { body: {} });
    assert.equal(res.status, 401);
  });

  it('deskripsi tersimpan ke riwayat dan kuota berkurang', async () => {
    const u = await app.register();
    const res = await app.describe(u.token);
    assert.equal(res.status, 201);
    assert.equal(res.body.text, 'Seekor kucing duduk di atas sofa.');
    assert.ok(res.body.riwayat_id > 0);
    assert.deepEqual(
      { terpakai: res.body.kuota.terpakai, sisa: res.body.kuota.sisa, batas: res.body.kuota.batas },
      { terpakai: 1, sisa: 9, batas: 10 },
    );
    const detail = await app.api('GET', `/api/v1/history/${res.body.riwayat_id}`, { token: u.token });
    assert.equal(detail.body.url_halaman, 'https://berita.id/a');
    assert.equal(detail.body.teks_deskripsi, 'Seekor kucing duduk di atas sofa.');
  });

  it('UC-GBR-04 alt: kuota Gratis 10/hari, permintaan ke-11 ditolak tanpa memanggil AI', async () => {
    const u = await app.register();
    for (let i = 0; i < 10; i++) assert.equal((await app.describe(u.token)).status, 201);
    const before = app.ai.calls;
    const res = await app.describe(u.token);
    assert.equal(res.status, 429);
    assert.equal(res.body.error.code, 'QUOTA_EXCEEDED');
    assert.match(res.body.error.message, /00\.00 WITA/);
    assert.equal(app.ai.calls, before);
  });

  it('kuota direset pukul 00.00 WITA (bukan UTC)', async () => {
    const u = await app.register();
    app.clock.set('2026-10-08T15:30:00Z'); // 23.30 WITA tanggal 8
    for (let i = 0; i < 10; i++) await app.describe(u.token);
    assert.equal((await app.describe(u.token)).status, 429);
    app.clock.set('2026-10-08T16:01:00Z'); // 00.01 WITA tanggal 9 (UTC masih tanggal 8)
    const res = await app.describe(u.token);
    assert.equal(res.status, 201);
    assert.equal(res.body.kuota.tanggal, '2026-10-09');
  });

  it('permintaan serentak tidak bisa melewati batas kuota', async () => {
    const u = await app.register();
    const results = await Promise.all(Array.from({ length: 15 }, () => app.describe(u.token)));
    assert.equal(results.filter((r) => r.status === 201).length, 10);
    assert.equal(results.filter((r) => r.status === 429).length, 5);
  });

  it('AI gagal → kuota dikembalikan & riwayat tidak dibuat (RNF-06)', async () => {
    const u = await app.register();
    app.ai.fail = Errors.aiUnavailable();
    const res = await app.describe(u.token);
    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, 'AI_UNAVAILABLE');
    const q = await app.api('GET', '/api/v1/me/quota', { token: u.token });
    assert.equal(q.body.terpakai, 0);
    assert.equal((await app.api('GET', '/api/v1/history', { token: u.token })).body.total, 0);
  });

  it('gambar tidak valid → 400, kuota tidak terpakai', async () => {
    const u = await app.register();
    const res = await app.describe(u.token, { image_base64: '###' });
    assert.equal(res.status, 400);
    assert.equal((await app.api('GET', '/api/v1/me/quota', { token: u.token })).body.terpakai, 0);
  });

  it('UC-RWY-02: Gratis hanya melihat 7 hari terakhir; data lama disembunyikan, bukan dihapus', async () => {
    const u = await app.register();
    await app.describe(u.token, { page_url: 'https://lama.id' });
    app.clock.advanceDays(8);
    // token lama sudah kedaluwarsa (7 hari) → login ulang
    const token = (await app.api('POST', '/api/v1/auth/login', { body: { email: u.email, kata_sandi: u.password } })).body.token;
    await app.describe(token, { page_url: 'https://baru.id' });
    const list = await app.api('GET', '/api/v1/history', { token });
    assert.equal(list.body.total, 1);
    assert.equal(list.body.items[0].url_halaman, 'https://baru.id');
    assert.equal(list.body.batas_hari, 7);
    assert.equal(list.body.tersembunyi, 1);
    const n = await app.db.get('SELECT COUNT(*) AS n FROM riwayat_deskripsi WHERE user_id = ?', [u.user.user_id]);
    assert.equal(Number(n.n), 2);
  });

  it('UC-RWY-02 alt: riwayat kosong', async () => {
    const u = await app.register();
    const res = await app.api('GET', '/api/v1/history', { token: u.token });
    assert.deepEqual(res.body.items, []);
  });

  it('UC-RWY-03/04: tidak bisa melihat/menghapus riwayat milik orang lain; hapus milik sendiri', async () => {
    const a = await app.register();
    const b = await app.register();
    const { body } = await app.describe(a.token);
    assert.equal((await app.api('GET', `/api/v1/history/${body.riwayat_id}`, { token: b.token })).status, 404);
    assert.equal((await app.api('DELETE', `/api/v1/history/${body.riwayat_id}`, { token: b.token })).status, 404);
    assert.equal((await app.api('DELETE', `/api/v1/history/${body.riwayat_id}`, { token: a.token })).status, 200);
    assert.equal((await app.api('GET', `/api/v1/history/${body.riwayat_id}`, { token: a.token })).status, 404);
    assert.equal((await app.api('GET', '/api/v1/history/abc', { token: a.token })).status, 404);
  });

  it('Tahap 1: jenis gambar & provider disimpan di riwayat; petunjuk halaman diteruskan ke AI', async () => {
    const u = await app.register();
    const original = app.ai.caption;
    let seen;
    app.ai.caption = async (args) => {
      seen = args;
      return { text: 'Grafik: Penjualan naik.', textEn: '', lang: 'id', model: 'flash', latencyMs: 1, jenis: 'grafik', provider: 'gemini' };
    };
    try {
      const res = await app.describe(u.token, { context: { alt: 'IMG_1.jpg', caption: '  Penjualan\n2026 ', rahasia: 'x' } });
      assert.equal(res.status, 201);
      assert.equal(res.body.jenis, 'grafik');
      assert.equal(res.body.provider, 'gemini');
      assert.deepEqual(seen.context, { alt: 'IMG_1.jpg', caption: 'Penjualan 2026' });
      const detail = await app.api('GET', `/api/v1/history/${res.body.riwayat_id}`, { token: u.token });
      assert.equal(detail.body.jenis_gambar, 'grafik');
      assert.equal(detail.body.provider, 'gemini');
      // Nilai di luar daftar tidak disimpan
      app.ai.caption = async () => ({ text: 'x', lang: 'id', model: 'm', jenis: 'lukisan<script>', provider: 'blip palsu!' });
      const odd = await app.describe(u.token);
      assert.equal(odd.body.jenis, null);
      assert.equal(odd.body.provider, null);
    } finally {
      app.ai.caption = original;
    }
  });

  it('Tahap 1: AI ditahan filter keamanan → 422 jelas, kuota dikembalikan', async () => {
    const u = await app.register();
    app.ai.fail = Errors.aiBlocked();
    const res = await app.describe(u.token);
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'AI_BLOCKED');
    assert.equal((await app.api('GET', '/api/v1/me/quota', { token: u.token })).body.terpakai, 0);
  });

  it('paginasi riwayat', async () => {
    const u = await app.register();
    for (let i = 0; i < 5; i++) await app.describe(u.token, { page_url: `https://h${i}.id` });
    const p1 = await app.api('GET', '/api/v1/history?limit=2&page=1', { token: u.token });
    const p3 = await app.api('GET', '/api/v1/history?limit=2&page=3', { token: u.token });
    assert.equal(p1.body.items.length, 2);
    assert.equal(p1.body.total, 5);
    assert.equal(p3.body.items.length, 1);
  });
});
