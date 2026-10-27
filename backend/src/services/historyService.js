import { Errors } from '../lib/errors.js';
import { sqlToIso, toSqlDateTime } from '../lib/time.js';
import * as v from '../lib/validate.js';

/**
 * Riwayat deskripsi: RF-13..RF-16 (UC-RWY-01..04).
 * Pengguna Gratis hanya melihat 7 hari terakhir; data lebih lama disembunyikan,
 * tidak dihapus, dan terlihat lagi setelah upgrade (ADR-12).
 */
export function createHistoryService({ db, config, clock }) {
  const cutoff = (premium) =>
    premium ? null : toSqlDateTime(new Date(clock.now().getTime() - config.freeHistoryDays * 86400000));

  const mapRow = (r) => ({
    riwayat_id: r.riwayat_id,
    url_halaman: r.url_halaman,
    url_gambar: r.url_gambar,
    teks_deskripsi: r.teks_deskripsi,
    jenis_gambar: r.jenis_gambar ?? null,
    provider: r.provider ?? null,
    waktu_dibuat: sqlToIso(r.waktu_dibuat),
  });
  const COLUMNS = 'riwayat_id, url_halaman, url_gambar, teks_deskripsi, jenis_gambar, provider, waktu_dibuat';

  // UC-RWY-01
  async function save(userId, { urlHalaman, urlGambar, teks, jenis = null, provider = null }) {
    const res = await db.run(
      `INSERT INTO riwayat_deskripsi (user_id, url_halaman, url_gambar, teks_deskripsi, jenis_gambar, provider, waktu_dibuat)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, urlHalaman, urlGambar, teks, jenis, provider, toSqlDateTime(clock.now())],
    );
    return res.insertId;
  }

  // UC-RWY-02
  async function list(userId, premium, query) {
    const { page, limit, offset } = v.pagination(query);
    const c = cutoff(premium);
    const where = c ? 'user_id = ? AND waktu_dibuat >= ?' : 'user_id = ?';
    const params = c ? [userId, c] : [userId];
    const rows = await db.all(
      `SELECT ${COLUMNS} FROM riwayat_deskripsi
        WHERE ${where} ORDER BY waktu_dibuat DESC, riwayat_id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    const total = Number((await db.get(`SELECT COUNT(*) AS n FROM riwayat_deskripsi WHERE ${where}`, params)).n);
    const hidden = c
      ? Number(
          (await db.get('SELECT COUNT(*) AS n FROM riwayat_deskripsi WHERE user_id = ? AND waktu_dibuat < ?', [userId, c]))
            .n,
        )
      : 0;
    return {
      items: rows.map(mapRow),
      total,
      page,
      limit,
      batas_hari: premium ? null : config.freeHistoryDays,
      tersembunyi: hidden,
    };
  }

  async function findVisible(userId, premium, riwayatId) {
    const id = v.id(riwayatId, 'Riwayat');
    const c = cutoff(premium);
    const row = await db.get(
      `SELECT ${COLUMNS} FROM riwayat_deskripsi
        WHERE riwayat_id = ? AND user_id = ?${c ? ' AND waktu_dibuat >= ?' : ''}`,
      c ? [id, userId, c] : [id, userId],
    );
    if (!row) throw Errors.notFound('Riwayat');
    return row;
  }

  // UC-RWY-03
  async function get(userId, premium, riwayatId) {
    return mapRow(await findVisible(userId, premium, riwayatId));
  }

  // UC-RWY-04 — laporan terkait ikut terhapus (ON DELETE CASCADE)
  async function remove(userId, premium, riwayatId) {
    const row = await findVisible(userId, premium, riwayatId);
    await db.run('DELETE FROM riwayat_deskripsi WHERE riwayat_id = ? AND user_id = ?', [row.riwayat_id, userId]);
    return { dihapus: true };
  }

  return { save, list, get, remove, findVisible };
}
