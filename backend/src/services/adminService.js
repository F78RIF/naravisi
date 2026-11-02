import { Errors } from '../lib/errors.js';
import { hashPassword } from '../lib/password.js';
import { sqlToIso } from '../lib/time.js';
import * as v from '../lib/validate.js';

/** Pengelolaan pengguna oleh Admin: RF-27..RF-30 (UC-ADM-01..04). */
export function createAdminService({ db, accounts, subscriptions }) {
  async function mapUser(u) {
    const sub = await subscriptions.status(u.user_id);
    return {
      user_id: u.user_id,
      nama: u.nama,
      email: u.email,
      peran: u.peran,
      status_akun: u.status_akun,
      jenis_pengguna: u.peran === 'admin' ? 'Admin' : sub.premium ? 'Premium' : 'Gratis',
      premium_hingga: sub.berlaku_hingga,
      tanggal_registrasi: sqlToIso(u.tanggal_registrasi),
    };
  }

  // UC-ADM-02 (alur alternatif: pencarian)
  async function listUsers(query) {
    const { page, limit, offset } = v.pagination(query);
    const q = typeof query?.q === 'string' ? query.q.trim().slice(0, 100) : '';
    const where = q ? ' WHERE nama LIKE ? OR email LIKE ?' : '';
    const params = q ? [`%${q}%`, `%${q}%`] : [];
    const rows = await db.all(
      `SELECT user_id, nama, email, peran, status_akun, tanggal_registrasi FROM users${where}
        ORDER BY tanggal_registrasi DESC, user_id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    const total = Number((await db.get(`SELECT COUNT(*) AS n FROM users${where}`, params)).n);
    return { items: await Promise.all(rows.map(mapUser)), total, page, limit };
  }

  async function getUser(userId) {
    const u = await db.get(
      'SELECT user_id, nama, email, peran, status_akun, tanggal_registrasi FROM users WHERE user_id = ?',
      [v.id(userId, 'Pengguna')],
    );
    if (!u) throw Errors.notFound('Pengguna');
    return mapUser(u);
  }

  // UC-ADM-01
  async function createUser(body) {
    const nama = v.str(body, 'nama', { label: 'Nama', min: 2, max: 100 });
    const email = v.email(body);
    const kataSandi = v.password(body);
    const peran = v.oneOf(body, 'peran', ['pengguna', 'admin'], { label: 'Peran', optional: true }) ?? 'pengguna';
    const id = await db.transaction((tx) => accounts.createUser(tx, { nama, email, kataSandi, peran }));
    return getUser(id);
  }

  // UC-ADM-03
  async function updateUser(adminId, userId, body) {
    const id = v.id(userId, 'Pengguna');
    await getUser(id);
    const changes = {};
    const nama = v.str(body, 'nama', { label: 'Nama', min: 2, max: 100, optional: true });
    if (nama !== undefined) changes.nama = nama;
    const email = v.email(body, 'email', { optional: true });
    if (email !== undefined) changes.email = email;
    const peran = v.oneOf(body, 'peran', ['pengguna', 'admin'], { label: 'Peran', optional: true });
    if (peran !== undefined) changes.peran = peran;
    const status = v.oneOf(body, 'status_akun', ['aktif', 'nonaktif'], { label: 'Status akun', optional: true });
    if (status !== undefined) changes.status_akun = status;
    const sandi = v.password(body, 'kata_sandi', { optional: true });
    if (sandi !== undefined) changes.kata_sandi = await hashPassword(sandi);

    if (id === adminId && (changes.peran === 'pengguna' || changes.status_akun === 'nonaktif')) {
      throw Errors.validation('peran', 'Anda tidak dapat menurunkan peran atau menonaktifkan akun sendiri.');
    }
    const fields = Object.keys(changes);
    if (!fields.length) throw Errors.validation('nama', 'Tidak ada perubahan yang dikirim.');
    const losesAdmin = changes.peran === 'pengguna' || changes.status_akun === 'nonaktif';
    try {
      await db.transaction(async (tx) => {
        // Cek & ubah dalam satu transaksi agar dua Admin tidak bisa saling menurunkan bersamaan.
        if (losesAdmin) await assertNotLastAdmin(tx, id);
        await tx.run(`UPDATE users SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE user_id = ?`, [
          ...fields.map((f) => changes[f]),
          id,
        ]);
      });
    } catch (err) {
      if (err.isDuplicate) throw Errors.emailTaken();
      throw err;
    }
    return getUser(id);
  }

  /**
   * RF-30: sistem harus selalu punya minimal satu Admin aktif. Bila `userId` adalah Admin aktif dan tidak ada Admin
   * aktif lain, perubahan yang membuatnya bukan Admin aktif (hapus, turunkan, nonaktifkan) ditolak.
   * Di MySQL baris Admin dikunci (FOR UPDATE) sampai transaksi selesai; SQLite sudah berurutan per transaksi.
   */
  async function assertNotLastAdmin(tx, userId) {
    const lock = tx.driver === 'mysql' ? ' FOR UPDATE' : '';
    const admins = await tx.all(
      `SELECT user_id FROM users WHERE peran = 'admin' AND status_akun = 'aktif' ORDER BY user_id${lock}`,
      [],
    );
    const ids = admins.map((a) => Number(a.user_id));
    if (ids.includes(userId) && ids.length <= 1) throw Errors.lastAdmin();
  }

  // UC-ADM-04 / RF-30
  async function deleteUser(adminId, userId, body) {
    const id = v.id(userId, 'Pengguna');
    if (id === adminId) throw Errors.validation('user_id', 'Anda tidak dapat menghapus akun sendiri.');
    return db.transaction(async (tx) => {
      const target = await tx.get('SELECT user_id, email FROM users WHERE user_id = ?', [id]);
      if (!target) throw Errors.notFound('Pengguna');

      // Konfirmasi: Admin wajib mengetik email pengguna yang akan dihapus (huruf besar/kecil diabaikan).
      const typed = typeof body?.konfirmasi_email === 'string' ? body.konfirmasi_email.trim().toLowerCase() : '';
      if (!typed || typed !== String(target.email).toLowerCase()) {
        throw Errors.validation(
          'konfirmasi_email',
          'Email konfirmasi tidak cocok. Ketik email pengguna yang akan dihapus untuk mengonfirmasi.',
        );
      }
      await assertNotLastAdmin(tx, id);

      // Semua langkah di bawah berhasil bersama atau batal bersama (ROLLBACK).
      const riwayat = await tx.run('DELETE FROM riwayat_deskripsi WHERE user_id = ?', [id]); // laporannya ikut terhapus
      const transaksi = await tx.run('UPDATE transaksi SET user_id = NULL WHERE user_id = ?', [id]); // ADR-13
      await tx.run('UPDATE laporan_deskripsi SET admin_id = NULL WHERE admin_id = ?', [id]); // laporan yang ia tinjau tetap ada
      await tx.run('DELETE FROM users WHERE user_id = ?', [id]); // pengaturan, kuota, langganan: ON DELETE CASCADE
      return { dihapus: true, riwayat_dihapus: riwayat.changes, transaksi_dianonimkan: transaksi.changes };
    });
  }

  return { listUsers, getUser, createUser, updateUser, deleteUser };
}
