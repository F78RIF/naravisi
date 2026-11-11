// NaraVisi · backend/src/services/quotaService.js
// Fungsi   : Kuota harian Pengguna Gratis (reset 00.00 WITA): pesan & kembalikan.
// Kebutuhan: RF-09, RF-26
// Terkait  : descriptionService.js, subscriptionService.js, tabel kuota_harian

import { Errors } from '../lib/errors.js';

/**
 * Kuota harian Pengguna Gratis (ADR-07): FREE_DAILY_QUOTA per hari, reset 00.00 WITA.
 * Kuota "dipesan" sebelum memanggil AI dan dikembalikan bila AI gagal,
 * sehingga kegagalan server tidak mengurangi kuota pengguna.
 */
export function createQuotaService({ db, config, subscriptions }) {
  const limit = config.freeDailyQuota;

  async function used(userId, date) {
    const row = await db.get('SELECT jumlah_permintaan FROM kuota_harian WHERE user_id = ? AND tanggal = ?', [
      userId,
      date,
    ]);
    return row ? Number(row.jumlah_permintaan) : 0;
  }

  // [RF-26] Status & masa aktif langganan — sisa kuota harian untuk popup & profil
  async function summary(userId, premium) {
    const date = subscriptions.today();
    const count = await used(userId, date);
    return {
      tanggal: date,
      terpakai: count,
      batas: premium ? null : limit,
      sisa: premium ? null : Math.max(0, limit - count),
    };
  }

  // [RF-09] Mengirim gambar ke AI — penambahan kuota atomik (UPDATE … WHERE jumlah < batas)
  async function increment(userId, date, max) {
    const cond = max == null ? '' : ' AND jumlah_permintaan < ?';
    const params = max == null ? [userId, date] : [userId, date, max];
    const upd = await db.run(
      `UPDATE kuota_harian SET jumlah_permintaan = jumlah_permintaan + 1 WHERE user_id = ? AND tanggal = ?${cond}`,
      params,
    );
    if (upd.changes === 1) return true;

    const exists = await db.get('SELECT kuota_id FROM kuota_harian WHERE user_id = ? AND tanggal = ?', [userId, date]);
    if (exists) return false; // baris ada tetapi sudah mencapai batas
    try {
      await db.run('INSERT INTO kuota_harian (user_id, tanggal, jumlah_permintaan) VALUES (?, ?, 1)', [userId, date]);
      return true;
    } catch (err) {
      if (!err.isDuplicate) throw err;
      // Permintaan lain membuat baris lebih dulu — coba naikkan sekali lagi.
      const retry = await db.run(
        `UPDATE kuota_harian SET jumlah_permintaan = jumlah_permintaan + 1 WHERE user_id = ? AND tanggal = ?${cond}`,
        params,
      );
      return retry.changes === 1;
    }
  }

  // [RF-09] Mengirim gambar ke AI — kuota dipesan; release() mengembalikan bila AI gagal
  /** UC-GBR-04 langkah 1: memeriksa & memesan kuota. Mengembalikan fungsi release(). */
  async function reserve(userId, premium) {
    const date = subscriptions.today();
    const ok = await increment(userId, date, premium ? null : limit);
    if (!ok) throw Errors.quotaExceeded(limit);
    let released = false;
    return {
      date,
      async release() {
        if (released) return;
        released = true;
        await db.run(
          'UPDATE kuota_harian SET jumlah_permintaan = jumlah_permintaan - 1 WHERE user_id = ? AND tanggal = ? AND jumlah_permintaan > 0',
          [userId, date],
        );
      },
    };
  }

  return { summary, reserve };
}
