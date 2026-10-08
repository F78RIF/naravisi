import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { normalizeShortcut } from '../src/services/settingsService.js';
import { startTestApp } from './support/testApp.js';

describe('Pengaturan (UC-AKS-01..03)', () => {
  let app;
  before(async () => {
    app = await startTestApp();
  });
  after(() => app.close());

  it('UC-AKS-01: nilai bawaan', async () => {
    const u = await app.register();
    const res = await app.api('GET', '/api/v1/settings', { token: u.token });
    assert.deepEqual(res.body, {
      bahasa_deskripsi: 'id',
      pintasan_keyboard: 'Alt+Shift+N',
      kecepatan_suara: 1,
      nada_suara: 1,
      jenis_suara: null,
      fitur_premium: false,
    });
  });

  it('UC-AKS-02: ubah bahasa & pintasan (dinormalkan)', async () => {
    const u = await app.register();
    const res = await app.api('PUT', '/api/v1/settings', {
      token: u.token,
      body: { bahasa_deskripsi: 'en', pintasan_keyboard: 'shift+alt+y' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.bahasa_deskripsi, 'en');
    assert.equal(res.body.pintasan_keyboard, 'Alt+Shift+Y');
  });

  it('UC-AKS-02 alt: pintasan bentrok → 409; format salah → 400', async () => {
    const u = await app.register();
    const clash = await app.api('PUT', '/api/v1/settings', { token: u.token, body: { pintasan_keyboard: 'Ctrl+T' } });
    assert.equal(clash.status, 409);
    assert.equal(clash.body.error.code, 'SHORTCUT_CONFLICT');
    const bad = await app.api('PUT', '/api/v1/settings', { token: u.token, body: { pintasan_keyboard: 'Shift+N' } });
    assert.equal(bad.status, 400);
    const lang = await app.api('PUT', '/api/v1/settings', { token: u.token, body: { bahasa_deskripsi: 'fr' } });
    assert.equal(lang.status, 400);
  });

  it('UC-AKS-03: Gratis boleh atur kecepatan; nada & jenis suara khusus Premium', async () => {
    const u = await app.register();
    const speed = await app.api('PUT', '/api/v1/settings', { token: u.token, body: { kecepatan_suara: 1.5 } });
    assert.equal(speed.body.kecepatan_suara, 1.5);
    const range = await app.api('PUT', '/api/v1/settings', { token: u.token, body: { kecepatan_suara: 5 } });
    assert.equal(range.status, 400);
    for (const body of [{ nada_suara: 1.3 }, { jenis_suara: 'Google Bahasa Indonesia' }]) {
      const res = await app.api('PUT', '/api/v1/settings', { token: u.token, body });
      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, 'PREMIUM_REQUIRED');
      assert.match(res.body.error.message, /Upgrade ke Premium/);
    }
    // Mengembalikan ke suara default tetap boleh
    assert.equal((await app.api('PUT', '/api/v1/settings', { token: u.token, body: { jenis_suara: null } })).status, 200);
  });

  it('normalizeShortcut', () => {
    assert.equal(normalizeShortcut('shift+ctrl+k'), 'Ctrl+Shift+K');
    assert.equal(normalizeShortcut('Alt+Shift+n'), 'Alt+Shift+N');
  });
});

describe('Laporan (UC-LAP-01..03)', () => {
  let app;
  let user;
  let adminToken;
  let riwayatId;
  before(async () => {
    app = await startTestApp();
    user = await app.register({ nama: 'Pelapor' });
    adminToken = await app.loginAdmin();
    riwayatId = (await app.describe(user.token)).body.riwayat_id;
  });
  after(() => app.close());

  it('UC-LAP-01 alt: alasan wajib diisi', async () => {
    const res = await app.api('POST', '/api/v1/reports', { token: user.token, body: { riwayat_id: riwayatId } });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.details.field, 'alasan');
  });

  it('UC-LAP-01: kirim laporan', async () => {
    const res = await app.api('POST', '/api/v1/reports', {
      token: user.token,
      body: { riwayat_id: riwayatId, alasan: 'Gambar sebenarnya anjing, bukan kucing.' },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.status_laporan, 'baru');
  });

  it('tidak bisa melaporkan riwayat milik orang lain', async () => {
    const other = await app.register();
    const res = await app.api('POST', '/api/v1/reports', {
      token: other.token,
      body: { riwayat_id: riwayatId, alasan: 'iseng saja' },
    });
    assert.equal(res.status, 404);
  });

  it('RNF-10: pengguna biasa tidak bisa membuka daftar laporan Admin', async () => {
    assert.equal((await app.api('GET', '/api/v1/admin/reports', { token: user.token })).status, 403);
  });

  it('UC-LAP-02: Admin melihat laporan beserta gambar, deskripsi, alasan', async () => {
    const res = await app.api('GET', '/api/v1/admin/reports?status=baru', { token: adminToken });
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 1);
    const r = res.body.items[0];
    assert.equal(r.riwayat.url_gambar, 'https://berita.id/a.png');
    assert.equal(r.riwayat.teks_deskripsi, 'Seekor kucing duduk di atas sofa.');
    assert.equal(r.pelapor.nama, 'Pelapor');
  });

  it('UC-LAP-03: tandai ditinjau wajib tindak lanjut; peninjau tercatat', async () => {
    const list = await app.api('GET', '/api/v1/admin/reports', { token: adminToken });
    const id = list.body.items[0].laporan_id;
    const missing = await app.api('PATCH', `/api/v1/admin/reports/${id}`, {
      token: adminToken,
      body: { status_laporan: 'ditinjau' },
    });
    assert.equal(missing.status, 400);
    const ok = await app.api('PATCH', `/api/v1/admin/reports/${id}`, {
      token: adminToken,
      body: { status_laporan: 'ditinjau', tindak_lanjut: 'Dicatat sebagai contoh kesalahan model.' },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.status_laporan, 'ditinjau');
    assert.equal(ok.body.peninjau.nama, 'Admin Uji');
    assert.ok(ok.body.tanggal_tinjau);
    assert.equal((await app.api('PATCH', '/api/v1/admin/reports/9999', { token: adminToken, body: { status_laporan: 'baru' } })).status, 404);
  });

  it('hapus riwayat → laporannya ikut terhapus (ADR-13)', async () => {
    await app.api('DELETE', `/api/v1/history/${riwayatId}`, { token: user.token });
    const res = await app.api('GET', '/api/v1/admin/reports', { token: adminToken });
    assert.equal(res.body.total, 0);
  });
});
