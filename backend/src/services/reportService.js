import { Errors } from '../lib/errors.js';
import { sqlToIso, toSqlDateTime } from '../lib/time.js';
import * as v from '../lib/validate.js';

/** Pilihan alasan (RF-20). Kunci disimpan di kolom `kategori`; label + catatan disimpan di `alasan`. */
export const KATEGORI_LAPORAN = {
  objek_salah: 'Objek atau orang disebut salah',
  teks_salah: 'Tulisan di gambar salah dibaca',
  kurang_lengkap: 'Deskripsi kurang lengkap',
  jenis_salah: 'Jenis gambar salah',
  tidak_pantas: 'Bahasa tidak pantas atau menyinggung',
  lainnya: 'Lainnya',
};

/** Batas panjang catatan laporan (sama dengan maxlength di panel & halaman Riwayat). */
export const CATATAN_MAKS = 500;

/** Laporan deskripsi tidak akurat: RF-20..RF-22 (UC-LAP-01..03). */
export function createReportService({ db, clock, history }) {
  /** {kategori, catatan?} → { kategori, alasan }. Alasan wajib dipilih; teks bebas tanpa kategori ditolak. */
  function reason(body) {
    if (body?.kategori === undefined || body.kategori === null || body.kategori === '') {
      throw Errors.validation('kategori', 'Pilih alasan pelaporan terlebih dahulu.');
    }
    const kategori = v.oneOf(body, 'kategori', Object.keys(KATEGORI_LAPORAN), { label: 'Alasan pelaporan' });
    const catatan = v.str(body, 'catatan', { label: 'Catatan', min: 3, max: CATATAN_MAKS, optional: true });
    if (kategori === 'lainnya' && !catatan) {
      throw Errors.validation('catatan', 'Untuk alasan "Lainnya", tuliskan apa yang salah di catatan.');
    }
    const label = KATEGORI_LAPORAN[kategori];
    return { kategori, alasan: catatan ? `${label}: ${catatan}` : label };
  }

  // UC-LAP-01 — hanya riwayat milik sendiri yang masih terlihat (findVisible → 404 bila bukan miliknya)
  async function create(userId, premium, body) {
    const riwayat = await history.findVisible(userId, premium, body?.riwayat_id);
    const { kategori, alasan } = reason(body);
    const res = await db.run(
      'INSERT INTO laporan_deskripsi (riwayat_id, user_id, kategori, alasan, status_laporan, tanggal_laporan) VALUES (?, ?, ?, ?, ?, ?)',
      [riwayat.riwayat_id, userId, kategori, alasan, 'baru', toSqlDateTime(clock.now())],
    );
    return { laporan_id: res.insertId, status_laporan: 'baru', kategori };
  }

  const mapRow = (r) => ({
    laporan_id: r.laporan_id,
    status_laporan: r.status_laporan,
    kategori: r.kategori ?? null,
    alasan: r.alasan,
    tindak_lanjut: r.tindak_lanjut,
    tanggal_laporan: sqlToIso(r.tanggal_laporan),
    tanggal_tinjau: sqlToIso(r.tanggal_tinjau),
    riwayat: {
      riwayat_id: r.riwayat_id,
      url_gambar: r.url_gambar,
      url_halaman: r.url_halaman,
      teks_deskripsi: r.teks_deskripsi,
    },
    pelapor: { user_id: r.user_id, nama: r.pelapor_nama, email: r.pelapor_email },
    peninjau: r.admin_id ? { user_id: r.admin_id, nama: r.admin_nama } : null,
  });

  const SELECT = `SELECT l.*, r.url_gambar, r.url_halaman, r.teks_deskripsi,
                         u.nama AS pelapor_nama, u.email AS pelapor_email, a.nama AS admin_nama
                    FROM laporan_deskripsi l
                    JOIN riwayat_deskripsi r ON r.riwayat_id = l.riwayat_id
                    JOIN users u ON u.user_id = l.user_id
               LEFT JOIN users a ON a.user_id = l.admin_id`;

  // UC-LAP-02
  async function list(query) {
    const { page, limit, offset } = v.pagination(query);
    const status = ['baru', 'ditinjau'].includes(query?.status) ? query.status : null;
    const where = status ? ' WHERE l.status_laporan = ?' : '';
    const params = status ? [status] : [];
    const rows = await db.all(`${SELECT}${where} ORDER BY l.tanggal_laporan DESC, l.laporan_id DESC LIMIT ? OFFSET ?`, [
      ...params,
      limit,
      offset,
    ]);
    const total = Number((await db.get(`SELECT COUNT(*) AS n FROM laporan_deskripsi l${where}`, params)).n);
    return { items: rows.map(mapRow), total, page, limit };
  }

  // UC-LAP-03
  async function updateStatus(adminId, laporanId, body) {
    const id = v.id(laporanId, 'Laporan');
    const status = v.oneOf(body, 'status_laporan', ['baru', 'ditinjau'], { label: 'Status laporan' });
    const tindakLanjut = v.str(body, 'tindak_lanjut', { label: 'Tindak lanjut', max: 2000, optional: true }) ?? null;
    if (status === 'ditinjau' && !tindakLanjut) {
      throw Errors.validation('tindak_lanjut', 'Tindak lanjut wajib diisi saat laporan ditandai sudah ditinjau.');
    }
    const res = await db.run(
      'UPDATE laporan_deskripsi SET status_laporan = ?, tindak_lanjut = ?, admin_id = ?, tanggal_tinjau = ? WHERE laporan_id = ?',
      [
        status,
        tindakLanjut,
        status === 'ditinjau' ? adminId : null,
        status === 'ditinjau' ? toSqlDateTime(clock.now()) : null,
        id,
      ],
    );
    if (res.changes === 0) throw Errors.notFound('Laporan');
    return mapRow(await db.get(`${SELECT} WHERE l.laporan_id = ?`, [id]));
  }

  return { create, list, updateStatus };
}
