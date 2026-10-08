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
    try {
      await db.run(`UPDATE users SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE user_id = ?`, [
        ...fields.map((f) => changes[f]),
        id,
      ]);
    } catch (err) {
      if (err.isDuplicate) throw Errors.emailTaken();
      throw err;
    }
    return getUser(id);
  }

  // UC-ADM-04
  async function deleteUser(adminId, userId) {
    const id = v.id(userId, 'Pengguna');
    if (id === adminId) throw Errors.validation('user_id', 'Anda tidak dapat menghapus akun sendiri.');
    const res = await db.run('DELETE FROM users WHERE user_id = ?', [id]);
    if (res.changes === 0) throw Errors.notFound('Pengguna');
    return { dihapus: true };
  }

  return { listUsers, getUser, createUser, updateUser, deleteUser };
}
