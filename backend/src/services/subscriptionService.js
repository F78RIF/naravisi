// NaraVisi · backend/src/services/subscriptionService.js
// Fungsi   : Status Premium dihitung dari tabel langganan.
// Kebutuhan: RF-25, RF-26
// Terkait  : paymentService.js, quotaService.js, tabel langganan

import { addDays, dateInTz } from '../lib/time.js';

/**
 * Status Premium dihitung dari tabel langganan (ADR-09):
 * Premium = ada langganan dengan tanggal_berakhir ≥ hari ini (WITA).
 */
export function createSubscriptionService({ db, config, clock }) {
  const today = () => dateInTz(config.timeZone, clock.now());

  // [RF-26] Status & masa aktif langganan — Premium = ada langganan dengan tanggal_berakhir ≥ hari ini (WITA)
  async function status(userId, conn = db) {
    const t = today();
    const active = await conn.get(
      `SELECT l.langganan_id, l.tanggal_mulai, l.tanggal_berakhir, p.nama_paket
         FROM langganan l JOIN paket_premium p ON p.paket_id = l.paket_id
        WHERE l.user_id = ? AND l.tanggal_mulai <= ? AND l.tanggal_berakhir >= ?
        ORDER BY l.tanggal_berakhir DESC LIMIT 1`,
      [userId, t, t],
    );
    const last = await conn.get(
      'SELECT MAX(tanggal_berakhir) AS akhir FROM langganan WHERE user_id = ? AND tanggal_berakhir >= ?',
      [userId, t],
    );
    return {
      premium: Boolean(active),
      paket: active?.nama_paket ?? null,
      berlaku_hingga: last?.akhir ?? null, // termasuk perpanjangan yang sudah dibayar
    };
  }

  // [RF-26] Status & masa aktif langganan — ya/tidak Premium
  async function isPremium(userId, conn = db) {
    return (await status(userId, conn)).premium;
  }

  // [RF-26] Status & masa aktif langganan — riwayat langganan
  async function history(userId) {
    return db.all(
      `SELECT l.langganan_id, p.nama_paket, l.tanggal_mulai, l.tanggal_berakhir, t.order_id
         FROM langganan l
         JOIN paket_premium p ON p.paket_id = l.paket_id
         LEFT JOIN transaksi t ON t.transaksi_id = l.transaksi_id
        WHERE l.user_id = ? ORDER BY l.tanggal_mulai DESC`,
      [userId],
    );
  }

  // [RF-25] Pembayaran & aktivasi Premium — aktivasi Premium
  // [RF-26] Status & masa aktif langganan — masa aktif disambung bila masih aktif
  /** Membuat/memperpanjang langganan setelah pembayaran berhasil (W2): mulai setelah langganan aktif terakhir. */
  async function activate(tx, { userId, paketId, durasiHari, transaksiId }) {
    const t = today();
    const last = await tx.get(
      'SELECT MAX(tanggal_berakhir) AS akhir FROM langganan WHERE user_id = ? AND tanggal_berakhir >= ?',
      [userId, t],
    );
    const mulai = last?.akhir ? addDays(last.akhir, 1) : t;
    const berakhir = addDays(mulai, durasiHari - 1);
    await tx.run(
      'INSERT INTO langganan (user_id, paket_id, transaksi_id, tanggal_mulai, tanggal_berakhir) VALUES (?, ?, ?, ?, ?)',
      [userId, paketId, transaksiId, mulai, berakhir],
    );
    return { tanggal_mulai: mulai, tanggal_berakhir: berakhir };
  }

  return { status, isPremium, history, activate, today };
}
