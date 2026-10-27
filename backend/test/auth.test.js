import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { signJwt, verifyJwt } from '../src/lib/jwt.js';
import { hashPassword, verifyPassword } from '../src/lib/password.js';
import { startTestApp } from './support/testApp.js';

describe('lib: password & JWT', () => {
  it('hash scrypt dapat diverifikasi dan tidak menyimpan teks asli (RNF-08)', async () => {
    const h = await hashPassword('rahasia123');
    assert.ok(h.startsWith('scrypt$'));
    assert.ok(!h.includes('rahasia123'));
    assert.equal(await verifyPassword('rahasia123', h), true);
    assert.equal(await verifyPassword('salah', h), false);
    assert.equal(await verifyPassword('x', 'bukan-hash'), false);
  });

  it('JWT valid, tanda tangan dicek, kedaluwarsa terdeteksi', () => {
    const t = signJwt({ sub: 1 }, 'k', { expiresInSeconds: 60, now: 0 });
    assert.equal(verifyJwt(t, 'k', { now: 1000 }).sub, 1);
    assert.equal(verifyJwt(t, 'kunci-lain', { now: 1000 }), null);
    assert.equal(verifyJwt(`${t}x`, 'k', { now: 1000 }), null);
    assert.equal(verifyJwt('a.b', 'k'), null);
    assert.throws(() => verifyJwt(t, 'k', { now: 61000 }), { expired: true });
  });
});

describe('Akun: UC-AKUN-01..05', () => {
  let app;
  before(async () => {
    app = await startTestApp();
  });
  after(() => app.close());

  it('UC-AKUN-01: registrasi membuat akun Gratis dan mengembalikan token', async () => {
    const res = await app.api('POST', '/api/v1/auth/register', {
      body: { nama: 'Rina', email: 'Rina@Contoh.ID', kata_sandi: 'sandiku123' },
    });
    assert.equal(res.status, 201);
    assert.ok(res.body.token);
    assert.equal(res.body.user.email, 'rina@contoh.id');
    assert.equal(res.body.user.jenis_pengguna, 'Gratis');
    assert.equal(res.body.user.kuota.batas, 10);
  });

  it('UC-AKUN-01 alt: email sudah terdaftar → 409', async () => {
    const res = await app.api('POST', '/api/v1/auth/register', {
      body: { nama: 'Rina 2', email: 'rina@contoh.id', kata_sandi: 'sandiku123' },
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'EMAIL_TAKEN');
  });

  it('UC-AKUN-01 gagal: data tidak valid → 400 dengan nama field', async () => {
    for (const [body, field] of [
      [{ nama: 'A', email: 'a@b.id', kata_sandi: 'sandiku123' }, 'nama'],
      [{ nama: 'Andi', email: 'bukan-email', kata_sandi: 'sandiku123' }, 'email'],
      [{ nama: 'Andi', email: 'a@b.id', kata_sandi: 'pendek' }, 'kata_sandi'],
    ]) {
      const res = await app.api('POST', '/api/v1/auth/register', { body });
      assert.equal(res.status, 400, field);
      assert.equal(res.body.error.details.field, field);
    }
  });

  it('UC-AKUN-05: login benar → token; salah → 401 pesan generik', async () => {
    const ok = await app.api('POST', '/api/v1/auth/login', { body: { email: 'rina@contoh.id', kata_sandi: 'sandiku123' } });
    assert.equal(ok.status, 200);
    assert.ok(ok.body.token);
    for (const body of [
      { email: 'rina@contoh.id', kata_sandi: 'salah12345' },
      { email: 'tidakada@contoh.id', kata_sandi: 'sandiku123' },
    ]) {
      const bad = await app.api('POST', '/api/v1/auth/login', { body });
      assert.equal(bad.status, 401);
      assert.equal(bad.body.error.message, 'Email atau kata sandi salah.');
    }
  });

  it('RNF-09: endpoint terlindungi menolak tanpa token / token palsu / kedaluwarsa', async () => {
    assert.equal((await app.api('GET', '/api/v1/me')).status, 401);
    assert.equal((await app.api('GET', '/api/v1/me', { token: 'abc.def.ghi' })).status, 401);
    const u = await app.register();
    app.clock.advanceDays(8); // token berlaku 7 hari
    const res = await app.api('GET', '/api/v1/me', { token: u.token });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'SESSION_EXPIRED');
  });

  it('UC-AKUN-02: melihat profil', async () => {
    const u = await app.register({ nama: 'Budi' });
    const res = await app.api('GET', '/api/v1/me', { token: u.token });
    assert.equal(res.status, 200);
    assert.equal(res.body.nama, 'Budi');
    assert.equal(res.body.jenis_pengguna, 'Gratis');
  });

  it('UC-AKUN-03: ubah nama; ubah sandi wajib sandi lama', async () => {
    const u = await app.register();
    const rename = await app.api('PATCH', '/api/v1/me', { token: u.token, body: { nama: 'Nama Baru' } });
    assert.equal(rename.body.nama, 'Nama Baru');

    const wrong = await app.api('PATCH', '/api/v1/me', {
      token: u.token,
      body: { kata_sandi_lama: 'salah', kata_sandi_baru: 'sandibaru123' },
    });
    assert.equal(wrong.body.error.code, 'WRONG_PASSWORD');

    const short = await app.api('PATCH', '/api/v1/me', {
      token: u.token,
      body: { kata_sandi_lama: u.password, kata_sandi_baru: '123' },
    });
    assert.equal(short.status, 400);

    const ok = await app.api('PATCH', '/api/v1/me', {
      token: u.token,
      body: { kata_sandi_lama: u.password, kata_sandi_baru: 'sandibaru123' },
    });
    assert.equal(ok.status, 200);
    const login = await app.api('POST', '/api/v1/auth/login', { body: { email: u.email, kata_sandi: 'sandibaru123' } });
    assert.equal(login.status, 200);
  });

  it('RF-03: ubah email wajib sandi saat ini; email dipakai orang lain → 409; format salah → 400', async () => {
    const u = await app.register();
    const other = await app.register();
    const noPass = await app.api('PATCH', '/api/v1/me', { token: u.token, body: { email: 'baru@uji.id' } });
    assert.equal(noPass.status, 400);
    assert.equal(noPass.body.error.details.field, 'kata_sandi_lama');
    const wrong = await app.api('PATCH', '/api/v1/me', { token: u.token, body: { email: 'baru@uji.id', kata_sandi_lama: 'salah12345' } });
    assert.equal(wrong.body.error.code, 'WRONG_PASSWORD');
    const taken = await app.api('PATCH', '/api/v1/me', { token: u.token, body: { email: other.email, kata_sandi_lama: u.password } });
    assert.equal(taken.status, 409);
    assert.equal(taken.body.error.code, 'EMAIL_TAKEN');
    const bad = await app.api('PATCH', '/api/v1/me', { token: u.token, body: { email: 'bukan-email', kata_sandi_lama: u.password } });
    assert.equal(bad.status, 400);
    const ok = await app.api('PATCH', '/api/v1/me', { token: u.token, body: { email: '  Baru@Uji.ID ', kata_sandi_lama: u.password } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.email, 'baru@uji.id');
    assert.equal((await app.api('POST', '/api/v1/auth/login', { body: { email: 'baru@uji.id', kata_sandi: u.password } })).status, 200);
    // Email yang sama dengan sekarang tidak butuh sandi (tidak ada perubahan berarti)
    assert.equal((await app.api('PATCH', '/api/v1/me', { token: u.token, body: { email: 'baru@uji.id', nama: 'Tetap' } })).status, 200);
  });

  it('UC-AKUN-04: hapus akun wajib ketik "HAPUS" + sandi; riwayat ikut terhapus; token dicabut', async () => {
    const u = await app.register();
    await app.describe(u.token);
    const noConfirm = await app.api('DELETE', '/api/v1/me', { token: u.token, body: { kata_sandi: u.password } });
    assert.equal(noConfirm.status, 400);
    assert.equal(noConfirm.body.error.details.field, 'konfirmasi');
    const lower = await app.api('DELETE', '/api/v1/me', { token: u.token, body: { konfirmasi: 'hapus', kata_sandi: u.password } });
    assert.equal(lower.status, 400);
    const wrong = await app.api('DELETE', '/api/v1/me', { token: u.token, body: { konfirmasi: 'HAPUS', kata_sandi: 'keliru123' } });
    assert.equal(wrong.status, 400);
    assert.equal(wrong.body.error.code, 'WRONG_PASSWORD');
    const ok = await app.api('DELETE', '/api/v1/me', { token: u.token, body: { konfirmasi: 'HAPUS', kata_sandi: u.password } });
    assert.equal(ok.status, 200);
    const login = await app.api('POST', '/api/v1/auth/login', { body: { email: u.email, kata_sandi: u.password } });
    assert.equal(login.status, 401);
    assert.equal((await app.api('GET', '/api/v1/me', { token: u.token })).status, 401);
    assert.equal((await app.api('GET', '/api/v1/history', { token: u.token })).status, 401);
    const rows = await app.db.get('SELECT COUNT(*) AS n FROM riwayat_deskripsi WHERE user_id = ?', [u.user.user_id]);
    assert.equal(Number(rows.n), 0);
  });

  it('RF-04: laporan, pengaturan, dan kuota ikut terhapus; data akun lain tetap; konfirmasi bukan teks → 400', async () => {
    const u = await app.register();
    const other = await app.register();
    const riwayatId = (await app.describe(u.token)).body.riwayat_id;
    await app.describe(other.token);
    assert.equal((await app.api('POST', '/api/v1/reports', { token: u.token, body: { riwayat_id: riwayatId, kategori: 'teks_salah' } })).status, 201);
    const notText = await app.api('DELETE', '/api/v1/me', { token: u.token, body: { konfirmasi: ['HAPUS'], kata_sandi: u.password } });
    assert.equal(notText.status, 400);
    assert.equal(notText.body.error.details.field, 'konfirmasi');
    assert.match(notText.body.error.message, /Ketik HAPUS/);
    assert.equal((await app.api('DELETE', '/api/v1/me', { token: u.token, body: { konfirmasi: 'HAPUS', kata_sandi: u.password } })).status, 200);
    for (const table of ['laporan_deskripsi', 'pengaturan_aksesibilitas', 'kuota_harian', 'riwayat_deskripsi']) {
      const mine = await app.db.get(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`, [u.user.user_id]);
      assert.equal(Number(mine.n), 0, table);
    }
    const theirs = await app.db.get('SELECT COUNT(*) AS n FROM riwayat_deskripsi WHERE user_id = ?', [other.user.user_id]);
    assert.equal(Number(theirs.n), 1);
    assert.equal((await app.api('GET', '/api/v1/me', { token: other.token })).status, 200);
  });

  it('RF-03: nama/sandi bukan teks → 400 berbahasa Indonesia; tanpa perubahan → 400', async () => {
    const u = await app.register();
    const nama = await app.api('PATCH', '/api/v1/me', { token: u.token, body: { nama: { $ne: 1 } } });
    assert.deepEqual([nama.status, nama.body.error.message], [400, 'Nama harus berupa teks.']);
    const sandi = await app.api('PATCH', '/api/v1/me', { token: u.token, body: { kata_sandi_lama: u.password, kata_sandi_baru: 12345678 } });
    assert.deepEqual([sandi.status, sandi.body.error.message], [400, 'Kata sandi baru harus berupa teks.']);
    const kosong = await app.api('PATCH', '/api/v1/me', { token: u.token, body: {} });
    assert.deepEqual([kosong.status, kosong.body.error.message], [400, 'Tidak ada perubahan yang dikirim.']);
    // Sandi lama salah tidak boleh mengubah apa pun, termasuk nama yang dikirim bersamaan
    const wrong = await app.api('PATCH', '/api/v1/me', { token: u.token, body: { nama: 'Tidak Jadi', email: 'lain@uji.id', kata_sandi_lama: 'salah12345' } });
    assert.equal(wrong.body.error.code, 'WRONG_PASSWORD');
    const me = await app.api('GET', '/api/v1/me', { token: u.token });
    assert.deepEqual([me.body.nama, me.body.email], [u.user.nama, u.email]);
  });

  it('token akun terhapus tidak berlaku untuk akun lain yang kebetulan mendapat ID sama', async () => {
    const u = await app.register();
    await app.api('DELETE', '/api/v1/me', { token: u.token, body: { konfirmasi: 'HAPUS', kata_sandi: u.password } });
    // Tiru basis data yang memakai ulang ID: akun baru dengan user_id yang sama, waktu registrasi berbeda.
    app.clock.advanceDays(1);
    await app.db.run(
      "INSERT INTO users (user_id, nama, email, kata_sandi, peran, status_akun, tanggal_registrasi) VALUES (?, 'Baru', 'idsama@uji.id', 'x', 'pengguna', 'aktif', ?)",
      [u.user.user_id, '2026-10-09 05:00:00'],
    );
    assert.equal((await app.api('GET', '/api/v1/me', { token: u.token })).status, 401);
    app.clock.set('2026-10-08T03:00:00Z');
  });

  it('JSON rusak → 400, rute tak dikenal → 404', async () => {
    const bad = await app.api('POST', '/api/v1/auth/login', { body: '{rusak' });
    assert.equal(bad.status, 400);
    assert.equal((await app.api('GET', '/api/v1/tidak-ada')).status, 404);
  });
});
