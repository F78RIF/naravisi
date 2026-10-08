import { randomBytes } from 'node:crypto';
import { Errors } from '../lib/errors.js';
import { sqlToIso, toSqlDateTime } from '../lib/time.js';
import * as v from '../lib/validate.js';
import { mapMidtransStatus } from './midtransClient.js';

/**
 * Paket & pembayaran Premium: RF-23..RF-26 (UC-PRM-01..04).
 * Mode:
 *  - "sandbox"  : MIDTRANS_SERVER_KEY diisi → Snap Midtrans (QRIS, e-wallet, VA).
 *  - "simulasi" : tanpa server key → halaman simulasi lokal untuk demo.
 */
export function createPaymentService({ db, config, clock, subscriptions, midtrans }) {
  const mode = midtrans.enabled ? (config.midtrans.isProduction ? 'produksi' : 'sandbox') : 'simulasi';

  const mapPlan = (p) => ({
    paket_id: p.paket_id,
    nama_paket: p.nama_paket,
    harga: Number(p.harga),
    durasi_hari: Number(p.durasi_hari),
    manfaat: String(p.manfaat).split('\n').filter(Boolean),
  });

  // UC-PRM-01
  async function listPlans() {
    const rows = await db.all('SELECT * FROM paket_premium WHERE aktif = 1 ORDER BY harga ASC');
    return { items: rows.map(mapPlan), mode_pembayaran: mode };
  }

  // UC-PRM-02 + UC-PRM-03 langkah 1–2
  async function create(user, body) {
    const paketId = v.id(body?.paket_id, 'Paket');
    const plan = await db.get('SELECT * FROM paket_premium WHERE paket_id = ? AND aktif = 1', [paketId]);
    if (!plan) throw Errors.notFound('Paket');
    const amount = Math.round(Number(plan.harga));
    const orderId = `NV-${user.id}-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`.toUpperCase();

    await db.run(
      'INSERT INTO transaksi (user_id, paket_id, order_id, jumlah, status_pembayaran, waktu_transaksi) VALUES (?, ?, ?, ?, ?, ?)',
      [user.id, paketId, orderId, amount, 'menunggu', toSqlDateTime(clock.now())],
    );

    let redirectUrl;
    let token = null;
    if (midtrans.enabled) {
      try {
        const snap = await midtrans.createTransaction({
          orderId,
          amount,
          itemId: paketId,
          itemName: `NaraVisi Premium ${plan.nama_paket}`,
          customer: { nama: user.nama, email: user.email },
          finishUrl: `${config.publicUrl}/pay/finish`,
        });
        redirectUrl = snap.redirectUrl;
        token = snap.token;
      } catch (err) {
        await db.run("UPDATE transaksi SET status_pembayaran = 'gagal' WHERE order_id = ?", [orderId]);
        throw err;
      }
    } else {
      redirectUrl = `${config.publicUrl}/pay/simulate/${orderId}`;
    }

    return {
      order_id: orderId,
      jumlah: amount,
      paket: mapPlan(plan),
      redirect_url: redirectUrl,
      snap_token: token,
      mode_pembayaran: mode,
    };
  }

  /**
   * Menerapkan status pembayaran secara idempoten dan aman dari balapan:
   * transaksi hanya berpindah ke "berhasil" satu kali, lalu langganan dibuat dalam transaksi DB yang sama.
   */
  async function applyStatus(orderId, newStatus, { metode = null } = {}) {
    return db.transaction(async (tx) => {
      const trx = await tx.get(
        `SELECT t.*, p.durasi_hari FROM transaksi t JOIN paket_premium p ON p.paket_id = t.paket_id WHERE t.order_id = ?`,
        [orderId],
      );
      if (!trx) throw Errors.notFound('Transaksi');
      if (trx.status_pembayaran === 'berhasil' || trx.status_pembayaran === newStatus) {
        return { changed: false, status: trx.status_pembayaran };
      }
      if (newStatus === 'berhasil') {
        const upd = await tx.run(
          "UPDATE transaksi SET status_pembayaran = 'berhasil', waktu_bayar = ?, metode_pembayaran = COALESCE(?, metode_pembayaran) WHERE order_id = ? AND status_pembayaran <> 'berhasil'",
          [toSqlDateTime(clock.now()), metode, orderId],
        );
        if (upd.changes === 1 && trx.user_id) {
          await subscriptions.activate(tx, {
            userId: trx.user_id,
            paketId: trx.paket_id,
            durasiHari: Number(trx.durasi_hari),
            transaksiId: trx.transaksi_id,
          });
        }
        return { changed: upd.changes === 1, status: 'berhasil' };
      }
      await tx.run(
        'UPDATE transaksi SET status_pembayaran = ?, metode_pembayaran = COALESCE(?, metode_pembayaran) WHERE order_id = ?',
        [newStatus, metode, orderId],
      );
      return { changed: true, status: newStatus };
    });
  }

  // UC-PRM-03 langkah 4: notifikasi dari Midtrans (webhook)
  async function handleNotification(body) {
    if (!midtrans.enabled) throw Errors.forbidden();
    if (!midtrans.verifySignature(body)) throw Errors.invalidSignature();
    const status = mapMidtransStatus(body);
    if (!status) return { diterima: true, diabaikan: true };
    await applyStatus(body.order_id, status, { metode: body.payment_type ?? null });
    return { diterima: true };
  }

  /** Status transaksi milik pengguna. Bila masih menunggu, cek langsung ke Midtrans (berguna saat webhook tak bisa menjangkau localhost). */
  async function get(user, orderId) {
    let trx = await db.get('SELECT * FROM transaksi WHERE order_id = ? AND user_id = ?', [String(orderId), user.id]);
    if (!trx) throw Errors.notFound('Transaksi');
    if (trx.status_pembayaran === 'menunggu' && midtrans.enabled) {
      const n = await midtrans.getStatus(trx.order_id);
      const status = n && mapMidtransStatus(n);
      if (status && status !== 'menunggu') {
        await applyStatus(trx.order_id, status, { metode: n.payment_type ?? null });
        trx = await db.get('SELECT * FROM transaksi WHERE order_id = ?', [trx.order_id]);
      }
    }
    return {
      order_id: trx.order_id,
      status_pembayaran: trx.status_pembayaran,
      metode_pembayaran: trx.metode_pembayaran,
      jumlah: Number(trx.jumlah),
      waktu_transaksi: sqlToIso(trx.waktu_transaksi),
      waktu_bayar: sqlToIso(trx.waktu_bayar),
      langganan: await subscriptions.status(user.id),
    };
  }

  // Mode simulasi (tanpa Midtrans)
  async function simulationInfo(orderId) {
    if (midtrans.enabled) throw Errors.notFound('Halaman');
    const trx = await db.get(
      `SELECT t.order_id, t.jumlah, t.status_pembayaran, p.nama_paket, u.email
         FROM transaksi t JOIN paket_premium p ON p.paket_id = t.paket_id LEFT JOIN users u ON u.user_id = t.user_id
        WHERE t.order_id = ?`,
      [String(orderId)],
    );
    if (!trx) throw Errors.notFound('Transaksi');
    return trx;
  }

  async function simulate(orderId, outcome) {
    await simulationInfo(orderId);
    const status = outcome === 'berhasil' ? 'berhasil' : 'gagal';
    await applyStatus(String(orderId), status, { metode: 'simulasi' });
    return status;
  }

  // UC-PRM-04
  async function subscription(userId) {
    return { ...(await subscriptions.status(userId)), riwayat: await subscriptions.history(userId) };
  }

  return { mode, listPlans, create, applyStatus, handleNotification, get, simulationInfo, simulate, subscription };
}
