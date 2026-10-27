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
      pintasan_keyboard: 'Alt+Shift+K',
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

  it('RF-17: pengaturan milik masing-masing pengguna; tanpa login → 401', async () => {
    const a = await app.register();
    const b = await app.register();
    await app.api('PUT', '/api/v1/settings', { token: a.token, body: { bahasa_deskripsi: 'en', kecepatan_suara: 1.8 } });
    const other = await app.api('GET', '/api/v1/settings', { token: b.token });
    assert.equal(other.body.bahasa_deskripsi, 'id');
    assert.equal(other.body.kecepatan_suara, 1);
    assert.equal((await app.api('GET', '/api/v1/settings')).status, 401);
    assert.equal((await app.api('PUT', '/api/v1/settings', { body: { kecepatan_suara: 1 } })).status, 401);
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
    assert.equal(normalizeShortcut('Alt+Shift+k'), 'Alt+Shift+K');
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

  it('UC-LAP-01 alt: alasan wajib dipilih', async () => {
    const res = await app.api('POST', '/api/v1/reports', { token: user.token, body: { riwayat_id: riwayatId } });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.details.field, 'kategori');
    // Teks bebas tanpa memilih alasan tidak lagi diterima (alasan wajib dipilih)
    const free = await app.api('POST', '/api/v1/reports', { token: user.token, body: { riwayat_id: riwayatId, alasan: 'Gambar sebenarnya anjing.' } });
    assert.equal(free.status, 400);
    assert.equal(free.body.error.details.field, 'kategori');
    assert.equal(free.body.error.message, 'Pilih alasan pelaporan terlebih dahulu.');
  });

  it('UC-LAP-01: kirim laporan', async () => {
    const res = await app.api('POST', '/api/v1/reports', {
      token: user.token,
      body: { riwayat_id: riwayatId, kategori: 'objek_salah', catatan: 'Gambar sebenarnya anjing, bukan kucing.' },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.status_laporan, 'baru');
  });

  it('tidak bisa melaporkan riwayat milik orang lain (404, tidak membocorkan keberadaannya)', async () => {
    const other = await app.register();
    const res = await app.api('POST', '/api/v1/reports', {
      token: other.token,
      body: { riwayat_id: riwayatId, kategori: 'objek_salah' },
    });
    assert.equal(res.status, 404);
    assert.equal(res.body.error.message, 'Riwayat tidak ditemukan.');
    const missing = await app.api('POST', '/api/v1/reports', { token: other.token, body: { riwayat_id: 999999, kategori: 'objek_salah' } });
    assert.deepEqual([missing.status, missing.body.error.message], [404, 'Riwayat tidak ditemukan.']);
    const bad = await app.api('POST', '/api/v1/reports', { token: other.token, body: { riwayat_id: '1 OR 1=1', kategori: 'objek_salah' } });
    assert.equal(bad.status, 404);
    const n = await app.db.get('SELECT COUNT(*) AS n FROM laporan_deskripsi WHERE user_id = ?', [other.user.user_id]);
    assert.equal(Number(n.n), 0);
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

describe('Laporan dengan pilihan alasan (RF-20)', () => {
  let app;
  let user;
  let adminToken;
  let riwayatId;
  before(async () => {
    app = await startTestApp();
    user = await app.register({ nama: 'Pelapor RF-20' });
    adminToken = await app.loginAdmin();
    riwayatId = (await app.describe(user.token)).body.riwayat_id;
  });
  after(() => app.close());

  it('RF-20: pilih alasan + catatan; "lainnya" wajib catatan; kategori tak dikenal ditolak', async () => {
    const bad = await app.api('POST', '/api/v1/reports', { token: user.token, body: { riwayat_id: riwayatId, kategori: 'iseng' } });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.details.field, 'kategori');
    const other = await app.api('POST', '/api/v1/reports', { token: user.token, body: { riwayat_id: riwayatId, kategori: 'lainnya' } });
    assert.equal(other.body.error.details.field, 'catatan');
    const noNote = await app.api('POST', '/api/v1/reports', { token: user.token, body: { riwayat_id: riwayatId, kategori: 'teks_salah' } });
    assert.equal(noNote.status, 201);
    assert.equal(noNote.body.kategori, 'teks_salah');
    const withNote = await app.api('POST', '/api/v1/reports', {
      token: user.token,
      body: { riwayat_id: riwayatId, kategori: 'objek_salah', catatan: ' Itu anjing, bukan kucing. ' },
    });
    assert.equal(withNote.status, 201);
    const row = await app.db.get('SELECT kategori, alasan FROM laporan_deskripsi WHERE laporan_id = ?', [withNote.body.laporan_id]);
    assert.deepEqual({ ...row }, { kategori: 'objek_salah', alasan: 'Objek atau orang disebut salah: Itu anjing, bukan kucing.' });
    const list = await app.api('GET', '/api/v1/admin/reports', { token: adminToken });
    assert.ok(list.body.items.some((r) => r.kategori === 'objek_salah'));
  });

  it('RF-20: catatan opsional maks. 500 karakter; bukan teks → 400', async () => {
    const max = await app.api('POST', '/api/v1/reports', { token: user.token, body: { riwayat_id: riwayatId, kategori: 'kurang_lengkap', catatan: 'a'.repeat(500) } });
    assert.equal(max.status, 201);
    const tooLong = await app.api('POST', '/api/v1/reports', { token: user.token, body: { riwayat_id: riwayatId, kategori: 'kurang_lengkap', catatan: 'a'.repeat(501) } });
    assert.equal(tooLong.status, 400);
    assert.equal(tooLong.body.error.details.field, 'catatan');
    assert.equal(tooLong.body.error.message, 'Catatan maksimal 500 karakter.');
    const notText = await app.api('POST', '/api/v1/reports', { token: user.token, body: { riwayat_id: riwayatId, kategori: 'kurang_lengkap', catatan: { x: 1 } } });
    assert.equal(notText.status, 400);
    const notStringKategori = await app.api('POST', '/api/v1/reports', { token: user.token, body: { riwayat_id: riwayatId, kategori: ['lainnya'] } });
    assert.equal(notStringKategori.body.error.details.field, 'kategori');
  });
});
