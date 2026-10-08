import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { mapMidtransStatus } from '../src/services/midtransClient.js';
import { startTestApp } from './support/testApp.js';

describe('Premium — mode simulasi (UC-PRM-01..04)', () => {
  let app;
  before(async () => {
    app = await startTestApp();
  });
  after(() => app.close());

  it('UC-PRM-01: paket Bulanan Rp15.000 / 30 hari', async () => {
    const res = await app.api('GET', '/api/v1/plans');
    assert.equal(res.body.mode_pembayaran, 'simulasi');
    assert.equal(res.body.items.length, 1);
    assert.deepEqual(
      { nama: res.body.items[0].nama_paket, harga: res.body.items[0].harga, durasi: res.body.items[0].durasi_hari },
      { nama: 'Bulanan', harga: 15000, durasi: 30 },
    );
  });

  it('UC-PRM-02/03: bayar (simulasi) → akun Premium, kuota tanpa batas, nada suara terbuka', async () => {
    const u = await app.register();
    const paketId = (await app.api('GET', '/api/v1/plans')).body.items[0].paket_id;
    const pay = await app.api('POST', '/api/v1/payments', { token: u.token, body: { paket_id: paketId } });
    assert.equal(pay.status, 201);
    assert.equal(pay.body.jumlah, 15000);
    assert.equal(pay.body.redirect_url, `http://naravisi.test/pay/simulate/${pay.body.order_id}`);

    const page = await app.api('GET', `/pay/simulate/${pay.body.order_id}`);
    assert.equal(page.status, 200);
    assert.match(page.body, /Mode simulasi/);
    assert.match(page.body, /Rp15\.000/);

    const done = await app.api('POST', `/pay/simulate/${pay.body.order_id}`, { form: { hasil: 'berhasil' } });
    assert.match(done.body, /Pembayaran berhasil/);

    const me = await app.api('GET', '/api/v1/me', { token: u.token });
    assert.equal(me.body.jenis_pengguna, 'Premium');
    assert.equal(me.body.langganan.berlaku_hingga, '2026-11-06'); // 8 Okt + 29 hari
    assert.equal(me.body.kuota.batas, null);

    const status = await app.api('GET', `/api/v1/payments/${pay.body.order_id}`, { token: u.token });
    assert.equal(status.body.status_pembayaran, 'berhasil');
    assert.equal(status.body.metode_pembayaran, 'simulasi');

    for (let i = 0; i < 12; i++) assert.equal((await app.describe(u.token)).status, 201);

    const s = await app.api('PUT', '/api/v1/settings', { token: u.token, body: { nada_suara: 1.4, jenis_suara: 'Suara A' } });
    assert.equal(s.status, 200);
    assert.equal(s.body.nada_suara, 1.4);
  });

  it('memproses ulang pembayaran yang sama tidak menambah masa aktif (idempoten)', async () => {
    const u = await app.register();
    const pay = await app.api('POST', '/api/v1/payments', { token: u.token, body: { paket_id: 1 } });
    await app.api('POST', `/pay/simulate/${pay.body.order_id}`, { form: { hasil: 'berhasil' } });
    await app.services.payments.applyStatus(pay.body.order_id, 'berhasil');
    const sub = await app.api('GET', '/api/v1/me/subscription', { token: u.token });
    assert.equal(sub.body.riwayat.length, 1);
  });

  it('W2: Premium memperpanjang → masa aktif disambung 30 hari', async () => {
    const u = await app.register();
    for (let i = 0; i < 2; i++) {
      const pay = await app.api('POST', '/api/v1/payments', { token: u.token, body: { paket_id: 1 } });
      await app.api('POST', `/pay/simulate/${pay.body.order_id}`, { form: { hasil: 'berhasil' } });
    }
    const sub = await app.api('GET', '/api/v1/me/subscription', { token: u.token });
    assert.equal(sub.body.premium, true);
    assert.equal(sub.body.berlaku_hingga, '2026-12-06');
    assert.equal(sub.body.riwayat.length, 2);
  });

  it('UC-PRM-03 alt: pembayaran gagal → tetap Gratis', async () => {
    const u = await app.register();
    const pay = await app.api('POST', '/api/v1/payments', { token: u.token, body: { paket_id: 1 } });
    await app.api('POST', `/pay/simulate/${pay.body.order_id}`, { form: { hasil: 'gagal' } });
    const status = await app.api('GET', `/api/v1/payments/${pay.body.order_id}`, { token: u.token });
    assert.equal(status.body.status_pembayaran, 'gagal');
    assert.equal((await app.api('GET', '/api/v1/me', { token: u.token })).body.jenis_pengguna, 'Gratis');
  });

  it('masa Premium habis → otomatis kembali Gratis dan riwayat lama tersembunyi lagi (ADR-09)', async () => {
    const u = await app.register();
    const pay = await app.api('POST', '/api/v1/payments', { token: u.token, body: { paket_id: 1 } });
    await app.api('POST', `/pay/simulate/${pay.body.order_id}`, { form: { hasil: 'berhasil' } });
    await app.describe(u.token);
    app.clock.advanceDays(31);
    const login = await app.api('POST', '/api/v1/auth/login', { body: { email: u.email, kata_sandi: u.password } });
    assert.equal(login.body.user.jenis_pengguna, 'Gratis');
    const hist = await app.api('GET', '/api/v1/history', { token: login.body.token });
    assert.equal(hist.body.total, 0);
    assert.equal(hist.body.tersembunyi, 1);
    app.clock.set('2026-10-08T03:00:00Z');
  });

  it('UC-PRM-04: transaksi orang lain tidak dapat dilihat; paket tidak ada → 404', async () => {
    const a = await app.register();
    const b = await app.register();
    const pay = await app.api('POST', '/api/v1/payments', { token: a.token, body: { paket_id: 1 } });
    assert.equal((await app.api('GET', `/api/v1/payments/${pay.body.order_id}`, { token: b.token })).status, 404);
    assert.equal((await app.api('POST', '/api/v1/payments', { token: a.token, body: { paket_id: 99 } })).status, 404);
  });

  it('webhook Midtrans ditolak saat mode simulasi', async () => {
    assert.equal((await app.api('POST', '/api/v1/payments/notification', { body: {} })).status, 403);
  });
});

describe('Premium — Midtrans Sandbox (klien asli, HTTP palsu)', () => {
  const KEY = 'SB-Mid-server-UJI';
  let app;
  before(async () => {
    app = await startTestApp({ midtransKey: KEY });
  });
  after(() => app.close());

  it('membuat transaksi Snap dengan Basic auth & gross_amount bulat', async () => {
    const u = await app.register({ nama: 'Sari' });
    const pay = await app.api('POST', '/api/v1/payments', { token: u.token, body: { paket_id: 1 } });
    assert.equal(pay.status, 201);
    assert.equal(pay.body.mode_pembayaran, 'sandbox');
    assert.match(pay.body.redirect_url, /^https:\/\/app\.sandbox\.midtrans\.com\//);
    const sent = app.mtHttp.created.at(-1);
    assert.equal(sent.auth, `Basic ${Buffer.from(`${KEY}:`).toString('base64')}`);
    assert.equal(sent.body.transaction_details.gross_amount, 15000);
    assert.equal(sent.body.customer_details.first_name, 'Sari');
    assert.equal(sent.body.callbacks.finish, 'http://naravisi.test/pay/finish');
  });

  it('notifikasi dengan tanda tangan salah → 403', async () => {
    const u = await app.register();
    const pay = await app.api('POST', '/api/v1/payments', { token: u.token, body: { paket_id: 1 } });
    const n = { ...app.mtHttp.notification(pay.body.order_id, 'settlement'), signature_key: 'palsu' };
    const res = await app.api('POST', '/api/v1/payments/notification', { body: n });
    assert.equal(res.status, 403);
    assert.equal((await app.api('GET', '/api/v1/me', { token: u.token })).body.jenis_pengguna, 'Gratis');
  });

  it('notifikasi settlement valid → Premium (dan notifikasi ganda aman)', async () => {
    const u = await app.register();
    const pay = await app.api('POST', '/api/v1/payments', { token: u.token, body: { paket_id: 1 } });
    const n = app.mtHttp.notification(pay.body.order_id, 'settlement');
    assert.equal((await app.api('POST', '/api/v1/payments/notification', { body: n })).status, 200);
    assert.equal((await app.api('POST', '/api/v1/payments/notification', { body: n })).status, 200);
    const sub = await app.api('GET', '/api/v1/me/subscription', { token: u.token });
    assert.equal(sub.body.premium, true);
    assert.equal(sub.body.riwayat.length, 1);
    const st = await app.api('GET', `/api/v1/payments/${pay.body.order_id}`, { token: u.token });
    assert.equal(st.body.metode_pembayaran, 'qris');
  });

  it('tanpa webhook (localhost): status dicek langsung ke Midtrans saat pengguna membuka status', async () => {
    const u = await app.register();
    const pay = await app.api('POST', '/api/v1/payments', { token: u.token, body: { paket_id: 1 } });
    const pending = await app.api('GET', `/api/v1/payments/${pay.body.order_id}`, { token: u.token });
    assert.equal(pending.body.status_pembayaran, 'menunggu');
    app.mtHttp.statuses.set(pay.body.order_id, app.mtHttp.notification(pay.body.order_id, 'settlement'));
    const paid = await app.api('GET', `/api/v1/payments/${pay.body.order_id}`, { token: u.token });
    assert.equal(paid.body.status_pembayaran, 'berhasil');
    assert.equal(paid.body.langganan.premium, true);
  });

  it('notifikasi expire → kedaluwarsa', async () => {
    const u = await app.register();
    const pay = await app.api('POST', '/api/v1/payments', { token: u.token, body: { paket_id: 1 } });
    await app.api('POST', '/api/v1/payments/notification', { body: app.mtHttp.notification(pay.body.order_id, 'expire') });
    const st = await app.api('GET', `/api/v1/payments/${pay.body.order_id}`, { token: u.token });
    assert.equal(st.body.status_pembayaran, 'kedaluwarsa');
  });

  it('pemetaan status Midtrans', () => {
    assert.equal(mapMidtransStatus({ transaction_status: 'capture', fraud_status: 'accept' }), 'berhasil');
    assert.equal(mapMidtransStatus({ transaction_status: 'capture', fraud_status: 'challenge' }), 'menunggu');
    assert.equal(mapMidtransStatus({ transaction_status: 'deny' }), 'gagal');
    assert.equal(mapMidtransStatus({ transaction_status: 'refund' }), null);
  });
});

describe('Admin — pengguna (UC-ADM-01..04)', () => {
  let app;
  let adminToken;
  before(async () => {
    app = await startTestApp();
    adminToken = await app.loginAdmin();
  });
  after(() => app.close());

  it('RNF-10: pengguna biasa ditolak', async () => {
    const u = await app.register();
    assert.equal((await app.api('GET', '/api/v1/admin/users', { token: u.token })).status, 403);
  });

  it('UC-ADM-01: tambah pengguna; email ganda ditolak', async () => {
    const res = await app.api('POST', '/api/v1/admin/users', {
      token: adminToken,
      body: { nama: 'Dewi', email: 'dewi@uji.id', kata_sandi: 'sandidewi1' },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.jenis_pengguna, 'Gratis');
    const dup = await app.api('POST', '/api/v1/admin/users', {
      token: adminToken,
      body: { nama: 'Dewi 2', email: 'dewi@uji.id', kata_sandi: 'sandidewi1' },
    });
    assert.equal(dup.status, 409);
    const login = await app.api('POST', '/api/v1/auth/login', { body: { email: 'dewi@uji.id', kata_sandi: 'sandidewi1' } });
    assert.equal(login.status, 200);
  });

  it('UC-ADM-02: daftar & pencarian', async () => {
    const all = await app.api('GET', '/api/v1/admin/users', { token: adminToken });
    assert.ok(all.body.total >= 3);
    const found = await app.api('GET', '/api/v1/admin/users?q=dewi', { token: adminToken });
    assert.equal(found.body.total, 1);
    assert.equal(found.body.items[0].email, 'dewi@uji.id');
  });

  it('UC-ADM-03: nonaktifkan akun → login & token lama ditolak', async () => {
    const u = await app.register();
    const res = await app.api('PATCH', `/api/v1/admin/users/${u.user.user_id}`, {
      token: adminToken,
      body: { status_akun: 'nonaktif' },
    });
    assert.equal(res.body.status_akun, 'nonaktif');
    const login = await app.api('POST', '/api/v1/auth/login', { body: { email: u.email, kata_sandi: u.password } });
    assert.equal(login.body.error.code, 'ACCOUNT_DISABLED');
    assert.equal((await app.api('GET', '/api/v1/me', { token: u.token })).body.error.code, 'ACCOUNT_DISABLED');
  });

  it('Admin tidak bisa menonaktifkan / menghapus diri sendiri', async () => {
    const me = await app.api('GET', '/api/v1/me', { token: adminToken });
    const id = me.body.user_id;
    assert.equal((await app.api('PATCH', `/api/v1/admin/users/${id}`, { token: adminToken, body: { status_akun: 'nonaktif' } })).status, 400);
    assert.equal((await app.api('DELETE', `/api/v1/admin/users/${id}`, { token: adminToken })).status, 400);
  });

  it('UC-ADM-04: hapus pengguna → riwayat terhapus, transaksi tetap tanpa identitas (ADR-13)', async () => {
    const u = await app.register();
    await app.describe(u.token);
    const pay = await app.api('POST', '/api/v1/payments', { token: u.token, body: { paket_id: 1 } });
    const del = await app.api('DELETE', `/api/v1/admin/users/${u.user.user_id}`, { token: adminToken });
    assert.equal(del.status, 200);
    const trx = await app.db.get('SELECT user_id FROM transaksi WHERE order_id = ?', [pay.body.order_id]);
    assert.equal(trx.user_id, null);
    const hist = await app.db.get('SELECT COUNT(*) AS n FROM riwayat_deskripsi WHERE user_id = ?', [u.user.user_id]);
    assert.equal(Number(hist.n), 0);
    assert.equal((await app.api('DELETE', `/api/v1/admin/users/${u.user.user_id}`, { token: adminToken })).status, 404);
  });

  it('dashboard Admin disajikan di /admin/', async () => {
    const res = await app.api('GET', '/admin/');
    assert.equal(res.status, 200);
    assert.match(String(res.body), /Dashboard Admin/);
  });
});
