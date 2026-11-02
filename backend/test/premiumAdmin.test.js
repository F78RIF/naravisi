import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { buildRoutes } from '../src/http/routes.js';
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

  it('RF-23: daftar paket publik (tanpa login), hanya paket aktif, tidak membuat transaksi', async () => {
    await app.db.run('INSERT INTO paket_premium (nama_paket, harga, durasi_hari, manfaat, aktif) VALUES (?, ?, ?, ?, ?)', ['Lama', 5000, 7, '["x"]', 0]);
    const before = Number((await app.db.get('SELECT COUNT(*) AS n FROM transaksi')).n);
    const res = await app.api('GET', '/api/v1/plans');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.items.map((p) => p.nama_paket), ['Bulanan']);
    assert.ok(Array.isArray(res.body.items[0].manfaat) && res.body.items[0].manfaat.length > 0);
    assert.equal(Number((await app.db.get('SELECT COUNT(*) AS n FROM transaksi')).n), before);
    await app.db.run("DELETE FROM paket_premium WHERE nama_paket = 'Lama'");
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
    // RF-24: label SIMULASI jelas di judul tab, h1, kotak peringatan, dan setiap tombol.
    assert.match(page.body, /<title>SIMULASI pembayaran/);
    assert.match(page.body, /<h1>SIMULASI — pembayaran Premium/);
    assert.match(page.body, /Tidak ada uang yang ditagih/);
    const buttons = [...page.body.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);
    assert.deepEqual(buttons, ['SIMULASI: bayar berhasil', 'SIMULASI: pembayaran gagal']);
    assert.match(page.body, /Rp15\.000/);

    const done = await app.api('POST', `/pay/simulate/${pay.body.order_id}`, { form: { hasil: 'berhasil' } });
    assert.match(done.body, /<h1 role="status">SIMULASI: Pembayaran berhasil/);

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
    const n = app.mtHttp.pay(pay.body.order_id, 'settlement');
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
    await app.api('POST', '/api/v1/payments/notification', { body: app.mtHttp.pay(pay.body.order_id, 'expire') });
    const st = await app.api('GET', `/api/v1/payments/${pay.body.order_id}`, { token: u.token });
    assert.equal(st.body.status_pembayaran, 'kedaluwarsa');
  });

  // --- RF-25: webhook dicocokkan dengan database & dikonfirmasi ulang ke Status API ---------------
  const buy = async () => {
    const u = await app.register();
    const pay = await app.api('POST', '/api/v1/payments', { token: u.token, body: { paket_id: 1 } });
    return { u, orderId: pay.body.order_id };
  };
  const notify = (body) => app.api('POST', '/api/v1/payments/notification', { body });
  const stateOf = async ({ u, orderId }) => ({
    jenis: (await app.api('GET', '/api/v1/me', { token: u.token })).body.jenis_pengguna,
    status: (await app.db.get('SELECT status_pembayaran AS s FROM transaksi WHERE order_id = ?', [orderId])).s,
  });

  it('RF-25: nominal dimanipulasi ditolak (tanda tangan sah, nominal ≠ database) → tetap Gratis', async () => {
    const t = await buy();
    // Pembayaran Rp1.000 untuk order yang di database berharga Rp15.000.
    const res = await notify(app.mtHttp.pay(t.orderId, 'settlement', '1000.00'));
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'PAYMENT_MISMATCH');
    assert.deepEqual(await stateOf(t), { jenis: 'Gratis', status: 'menunggu' });
  });

  it('RF-25: nominal notifikasi cocok tetapi Status API Midtrans berbeda → ditolak', async () => {
    const t = await buy();
    app.mtHttp.statuses.set(t.orderId, app.mtHttp.notification(t.orderId, 'settlement', '1000.00'));
    const res = await notify(app.mtHttp.notification(t.orderId, 'settlement'));
    assert.equal(res.body.error.code, 'PAYMENT_MISMATCH');
    assert.deepEqual(await stateOf(t), { jenis: 'Gratis', status: 'menunggu' });
  });

  it('RF-25: notifikasi "settlement" tetapi Status API masih pending → tidak diaktifkan', async () => {
    const t = await buy();
    app.mtHttp.statuses.set(t.orderId, app.mtHttp.notification(t.orderId, 'pending'));
    const res = await notify(app.mtHttp.notification(t.orderId, 'settlement'));
    assert.equal(res.status, 200);
    assert.equal(res.body.status_pembayaran, 'menunggu');
    assert.deepEqual(await stateOf(t), { jenis: 'Gratis', status: 'menunggu' });
  });

  it('RF-25: transaksi tidak dikenal Status API Midtrans → 409, tidak diaktifkan', async () => {
    const t = await buy();
    const res = await notify(app.mtHttp.notification(t.orderId, 'settlement')); // statuses kosong → 404 di Midtrans
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'PAYMENT_UNCONFIRMED');
    assert.deepEqual(await stateOf(t), { jenis: 'Gratis', status: 'menunggu' });
  });

  it('RF-25: order_id yang tidak ada di database → 404', async () => {
    const res = await notify(app.mtHttp.pay('NV-TIDAK-ADA', 'settlement'));
    assert.equal(res.status, 404);
  });

  it('RF-25: cek status manual juga menolak nominal Status API yang berbeda', async () => {
    const t = await buy();
    app.mtHttp.statuses.set(t.orderId, app.mtHttp.notification(t.orderId, 'settlement', '1.00'));
    const st = await app.api('GET', `/api/v1/payments/${t.orderId}`, { token: t.u.token });
    assert.equal(st.body.status_pembayaran, 'menunggu');
    assert.equal(st.body.langganan.premium, false);
  });

  it('harga selalu dari database server: jumlah/harga kiriman klien diabaikan', async () => {
    const u = await app.register();
    const pay = await app.api('POST', '/api/v1/payments', {
      token: u.token,
      body: { paket_id: 1, jumlah: 1, harga: 1, gross_amount: 1 },
    });
    assert.equal(pay.body.jumlah, 15000);
    assert.equal(app.mtHttp.created.at(-1).body.transaction_details.gross_amount, 15000);
    const row = await app.db.get('SELECT jumlah FROM transaksi WHERE order_id = ?', [pay.body.order_id]);
    assert.equal(Number(row.jumlah), 15000);
  });

  it('server key Midtrans tidak pernah ikut dalam respons API', async () => {
    const u = await app.register();
    const pay = await app.api('POST', '/api/v1/payments', { token: u.token, body: { paket_id: 1 } });
    const plans = await app.api('GET', '/api/v1/plans');
    const st = await app.api('GET', `/api/v1/payments/${pay.body.order_id}`, { token: u.token });
    for (const r of [pay, plans, st]) assert.doesNotMatch(JSON.stringify(r.body), new RegExp(KEY));
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
    const del = await app.api('DELETE', `/api/v1/admin/users/${u.user.user_id}`, {
      token: adminToken,
      body: { konfirmasi_email: u.email },
    });
    assert.equal(del.status, 200);
    assert.equal(del.body.riwayat_dihapus, 1);
    assert.equal(del.body.transaksi_dianonimkan, 1);
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

describe('Admin — aturan RF-21/22/27..30 (Langkah 2)', () => {
  let app;
  let adminToken;
  let adminId;
  before(async () => {
    app = await startTestApp();
    adminToken = await app.loginAdmin();
    adminId = (await app.api('GET', '/api/v1/me', { token: adminToken })).body.user_id;
  });
  after(() => app.close());

  const count = async (sql, params = []) => Number((await app.db.get(sql, params)).n);
  const userCount = (id) => count('SELECT COUNT(*) AS n FROM users WHERE user_id = ?', [id]);
  const activeAdmins = () => count("SELECT COUNT(*) AS n FROM users WHERE peran = 'admin' AND status_akun = 'aktif'");

  async function newAdmin(email) {
    const res = await app.api('POST', '/api/v1/admin/users', {
      token: adminToken,
      body: { nama: `Admin ${email}`, email, kata_sandi: 'adminkedua1', peran: 'admin' },
    });
    assert.equal(res.status, 201);
    const login = await app.api('POST', '/api/v1/auth/login', { body: { email, kata_sandi: 'adminkedua1' } });
    return { id: res.body.user_id, token: login.body.token, email };
  }

  it('RNF-10: SETIAP rute /api/v1/admin dicek peran di server (pengguna → 403, tanpa login → 401)', async () => {
    const routes = buildRoutes({});
    const adminRoutes = routes.filter((r) => r.path.startsWith('/api/v1/admin'));
    assert.ok(adminRoutes.length >= 7, `rute admin ditemukan: ${adminRoutes.length}`);
    for (const r of adminRoutes) assert.equal(r.auth, 'admin', `${r.method} ${r.path} harus auth: 'admin'`);
    for (const r of routes.filter((x) => x.auth === 'admin')) assert.match(r.path, /^\/api\/v1\/admin\//);

    const u = await app.register();
    const attack = {
      nama: 'Penyusup',
      email: 'x@uji.id',
      kata_sandi: 'sandiku123',
      peran: 'admin',
      status_akun: 'nonaktif',
      status_laporan: 'baru',
      konfirmasi_email: 'admin@uji.id',
    };
    for (const r of adminRoutes) {
      const path = r.path.replace(':id', String(adminId));
      const body = r.method === 'GET' ? undefined : attack;
      const asUser = await app.api(r.method, path, { token: u.token, body });
      assert.equal(asUser.status, 403, `${r.method} ${path} sebagai pengguna`);
      assert.equal(asUser.body.error.code, 'FORBIDDEN');
      const anon = await app.api(r.method, path, { body });
      assert.equal(anon.status, 401, `${r.method} ${path} tanpa login`);
    }
    // Percobaan di atas tidak mengubah apa pun.
    assert.equal(await userCount(adminId), 1);
    assert.equal(await activeAdmins(), 1);
    assert.equal(await count("SELECT COUNT(*) AS n FROM users WHERE email = 'x@uji.id'"), 0);
  });

  it('RNF-10: peran dibaca dari database, bukan dari token — Admin yang diturunkan langsung ditolak (403)', async () => {
    const b = await newAdmin('turun@uji.id');
    assert.equal((await app.api('GET', '/api/v1/admin/users', { token: b.token })).status, 200);
    const res = await app.api('PATCH', `/api/v1/admin/users/${b.id}`, { token: adminToken, body: { peran: 'pengguna' } });
    assert.equal(res.status, 200);
    assert.equal((await app.api('GET', '/api/v1/admin/users', { token: b.token })).status, 403);
    assert.equal((await app.api('GET', '/api/v1/admin/reports', { token: b.token })).status, 403);
  });

  it('RF-30: hapus wajib konfirmasi dengan mengetik email pengguna (kosong/salah → 400, data tetap ada)', async () => {
    const u = await app.register();
    const path = `/api/v1/admin/users/${u.user.user_id}`;
    const wrong = [undefined, {}, { konfirmasi_email: '' }, { konfirmasi_email: 'orang-lain@uji.id' }, { konfirmasi_email: 123 }];
    for (const body of wrong) {
      const res = await app.api('DELETE', path, { token: adminToken, body });
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
      assert.equal(res.body.error.details.field, 'konfirmasi_email');
    }
    assert.equal(await userCount(u.user.user_id), 1);
    // Huruf besar/kecil dan spasi di tepi diabaikan.
    const ok = await app.api('DELETE', path, { token: adminToken, body: { konfirmasi_email: `  ${u.email.toUpperCase()} ` } });
    assert.equal(ok.status, 200);
    assert.equal(await userCount(u.user.user_id), 0);
  });

  it('RF-30: Admin aktif terakhir tidak bisa dihapus, diturunkan, atau dinonaktifkan (409 LAST_ADMIN)', async () => {
    // Dari luar, Admin terakhir hanya bisa disasar oleh Admin yang baru saja kehilangan haknya (lihat uji
    // "bersamaan" di bawah). Di sini aturan diuji langsung di service dengan pelaku yang sudah tidak ada.
    assert.equal(await activeAdmins(), 1);
    const bekas = 999999;
    await assert.rejects(app.services.admin.deleteUser(bekas, adminId, { konfirmasi_email: 'admin@uji.id' }), {
      code: 'LAST_ADMIN',
      status: 409,
    });
    await assert.rejects(app.services.admin.updateUser(bekas, adminId, { peran: 'pengguna' }), { code: 'LAST_ADMIN' });
    await assert.rejects(app.services.admin.updateUser(bekas, adminId, { status_akun: 'nonaktif' }), { code: 'LAST_ADMIN' });
    const row = await app.db.get('SELECT peran, status_akun FROM users WHERE user_id = ?', [adminId]);
    assert.equal(row.peran, 'admin');
    assert.equal(row.status_akun, 'aktif');
    // Mengubah nama Admin terakhir tetap boleh.
    assert.equal((await app.services.admin.updateUser(bekas, adminId, { nama: 'Admin Uji' })).peran, 'admin');
  });

  it('RF-30: Admin yang baru diturunkan tidak bisa lagi menurunkan Admin lain (403), tetap ada 1 Admin aktif', async () => {
    const b = await newAdmin('kedua@uji.id');
    const r1 = await app.api('PATCH', `/api/v1/admin/users/${b.id}`, { token: adminToken, body: { peran: 'pengguna' } });
    const r2 = await app.api('PATCH', `/api/v1/admin/users/${adminId}`, { token: b.token, body: { peran: 'pengguna' } });
    assert.deepEqual([r1.status, r2.status], [200, 403]);
    assert.equal(await activeAdmins(), 1);
  });

  it('RF-30: Admin lain boleh dihapus selama masih ada Admin aktif', async () => {
    const b = await newAdmin('keempat@uji.id');
    const res = await app.api('DELETE', `/api/v1/admin/users/${b.id}`, { token: adminToken, body: { konfirmasi_email: b.email } });
    assert.equal(res.status, 200);
    assert.equal(await activeAdmins(), 1);
  });

  it('RF-30: hapus dalam SATU transaksi — bila langkah terakhir gagal, riwayat & transaksi tidak berubah', async () => {
    const u = await app.register();
    await app.describe(u.token);
    const pay = await app.api('POST', '/api/v1/payments', { token: u.token, body: { paket_id: 1 } });
    const realRun = app.db.run;
    app.db.run = async function (sql, params) {
      if (/^DELETE FROM users/.test(sql)) throw new Error('disk penuh (simulasi)');
      return realRun.call(this, sql, params);
    };
    let res;
    try {
      res = await app.api('DELETE', `/api/v1/admin/users/${u.user.user_id}`, {
        token: adminToken,
        body: { konfirmasi_email: u.email },
      });
    } finally {
      app.db.run = realRun;
    }
    assert.equal(res.status, 500);
    assert.equal(await userCount(u.user.user_id), 1);
    const hist = await count('SELECT COUNT(*) AS n FROM riwayat_deskripsi WHERE user_id = ?', [u.user.user_id]);
    assert.equal(hist, 1, 'riwayat harus kembali (ROLLBACK)');
    const trx = await app.db.get('SELECT user_id FROM transaksi WHERE order_id = ?', [pay.body.order_id]);
    assert.equal(Number(trx.user_id), u.user.user_id, 'transaksi tidak boleh teranonimkan sebagian');
  });

  it('RF-30: laporan yang pernah ditinjau Admin yang dihapus tetap ada (peninjau dikosongkan)', async () => {
    const b = await newAdmin('peninjau@uji.id');
    const u = await app.register();
    const d = await app.describe(u.token);
    const rep = await app.api('POST', '/api/v1/reports', {
      token: u.token,
      body: { riwayat_id: d.body.riwayat_id, kategori: 'objek_salah' },
    });
    assert.equal(rep.status, 201);
    const tinjau = await app.api('PATCH', `/api/v1/admin/reports/${rep.body.laporan_id}`, {
      token: b.token,
      body: { status_laporan: 'ditinjau', tindak_lanjut: 'Sudah dicek.' },
    });
    assert.equal(tinjau.body.peninjau.user_id, b.id);
    const del = await app.api('DELETE', `/api/v1/admin/users/${b.id}`, { token: adminToken, body: { konfirmasi_email: b.email } });
    assert.equal(del.status, 200);
    const list = await app.api('GET', '/api/v1/admin/reports', { token: adminToken });
    const item = list.body.items.find((x) => x.laporan_id === rep.body.laporan_id);
    assert.equal(item.status_laporan, 'ditinjau');
    assert.equal(item.peninjau, null);
  });

  it('RF-22: status laporan hanya "baru" atau "ditinjau" sesuai SRS; status lain ditolak', async () => {
    const u = await app.register();
    const d = await app.describe(u.token);
    const rep = await app.api('POST', '/api/v1/reports', {
      token: u.token,
      body: { riwayat_id: d.body.riwayat_id, kategori: 'teks_salah' },
    });
    for (const status of ['selesai', 'ditolak', 'diproses', '']) {
      const res = await app.api('PATCH', `/api/v1/admin/reports/${rep.body.laporan_id}`, {
        token: adminToken,
        body: { status_laporan: status, tindak_lanjut: 'x' },
      });
      assert.equal(res.status, 400, status);
    }
    const missing = await app.api('PATCH', '/api/v1/admin/reports/999999', { token: adminToken, body: { status_laporan: 'baru' } });
    assert.equal(missing.status, 404);
  });
});

describe('Admin — balapan: dua Admin terakhir saling menghapus/menurunkan bersamaan (RF-30)', () => {
  // Kedua permintaan sudah lolos cek peran (keduanya Admin aktif saat itu), lalu masuk ke service bersamaan.
  // Pemeriksaan "Admin terakhir" ada di dalam transaksi, jadi hanya satu yang boleh berhasil.
  async function twoAdmins() {
    const app = await startTestApp();
    const token = await app.loginAdmin();
    const a = (await app.api('GET', '/api/v1/me', { token })).body;
    const res = await app.api('POST', '/api/v1/admin/users', {
      token,
      body: { nama: 'Admin Dua', email: 'dua@uji.id', kata_sandi: 'adminkedua1', peran: 'admin' },
    });
    return { app, a: { id: a.user_id, email: a.email }, b: { id: res.body.user_id, email: 'dua@uji.id' } };
  }
  const settle = (p) => p.then(() => 'ok', (e) => e.code);
  const activeAdmins = async (app) =>
    Number((await app.db.get("SELECT COUNT(*) AS n FROM users WHERE peran = 'admin' AND status_akun = 'aktif'")).n);

  it('saling menurunkan → satu berhasil, satu LAST_ADMIN; tersisa tepat 1 Admin aktif', async () => {
    const { app, a, b } = await twoAdmins();
    try {
      const results = await Promise.all([
        settle(app.services.admin.updateUser(a.id, b.id, { peran: 'pengguna' })),
        settle(app.services.admin.updateUser(b.id, a.id, { peran: 'pengguna' })),
      ]);
      assert.deepEqual(results.sort(), ['LAST_ADMIN', 'ok']);
      assert.equal(await activeAdmins(app), 1);
    } finally {
      await app.close();
    }
  });

  it('saling menonaktifkan → satu berhasil, satu LAST_ADMIN', async () => {
    const { app, a, b } = await twoAdmins();
    try {
      const results = await Promise.all([
        settle(app.services.admin.updateUser(a.id, b.id, { status_akun: 'nonaktif' })),
        settle(app.services.admin.updateUser(b.id, a.id, { status_akun: 'nonaktif' })),
      ]);
      assert.deepEqual(results.sort(), ['LAST_ADMIN', 'ok']);
      assert.equal(await activeAdmins(app), 1);
    } finally {
      await app.close();
    }
  });

  it('saling menghapus → satu berhasil, satu LAST_ADMIN; tersisa tepat 1 Admin aktif', async () => {
    const { app, a, b } = await twoAdmins();
    try {
      const results = await Promise.all([
        settle(app.services.admin.deleteUser(a.id, b.id, { konfirmasi_email: b.email })),
        settle(app.services.admin.deleteUser(b.id, a.id, { konfirmasi_email: a.email })),
      ]);
      assert.deepEqual(results.sort(), ['LAST_ADMIN', 'ok']);
      assert.equal(await activeAdmins(app), 1);
    } finally {
      await app.close();
    }
  });
});
