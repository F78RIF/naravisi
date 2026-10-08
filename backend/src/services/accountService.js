import { Errors } from '../lib/errors.js';
import { signJwt, verifyJwt } from '../lib/jwt.js';
import { DUMMY_HASH, hashPassword, verifyPassword } from '../lib/password.js';
import { sqlToIso, toSqlDateTime } from '../lib/time.js';
import * as v from '../lib/validate.js';

/** Akun & profil: RF-01..RF-05 (UC-AKUN-01..05), autentikasi JWT (RNF-09). */
export function createAccountService({ db, config, clock, subscriptions, quota }) {
  function issueToken(user) {
    return signJwt({ sub: user.user_id, role: user.peran }, config.jwtSecret, {
      expiresInSeconds: config.jwtExpiresDays * 24 * 3600,
      now: clock.now().getTime(),
    });
  }

  async function profile(userId) {
    const u = await db.get(
      'SELECT user_id, nama, email, peran, status_akun, tanggal_registrasi FROM users WHERE user_id = ?',
      [userId],
    );
    if (!u) throw Errors.notFound('Akun');
    const sub = await subscriptions.status(userId);
    return {
      user_id: u.user_id,
      nama: u.nama,
      email: u.email,
      peran: u.peran,
      status_akun: u.status_akun,
      tanggal_registrasi: sqlToIso(u.tanggal_registrasi),
      jenis_pengguna: u.peran === 'admin' ? 'Admin' : sub.premium ? 'Premium' : 'Gratis',
      langganan: sub,
      kuota: await quota.summary(userId, sub.premium || u.peran === 'admin'),
    };
  }

  /** Dipakai juga oleh Admin (UC-ADM-01). */
  async function createUser(conn, { nama, email, kataSandi, peran = 'pengguna' }) {
    const hash = await hashPassword(kataSandi);
    let res;
    try {
      res = await conn.run(
        'INSERT INTO users (nama, email, kata_sandi, peran, status_akun, tanggal_registrasi) VALUES (?, ?, ?, ?, ?, ?)',
        [nama, email, hash, peran, 'aktif', toSqlDateTime(clock.now())],
      );
    } catch (err) {
      if (err.isDuplicate) throw Errors.emailTaken();
      throw err;
    }
    await conn.run('INSERT INTO pengaturan_aksesibilitas (user_id) VALUES (?)', [res.insertId]);
    return res.insertId;
  }

  // UC-AKUN-01
  async function register(body) {
    const nama = v.str(body, 'nama', { label: 'Nama', min: 2, max: 100 });
    const email = v.email(body);
    const kataSandi = v.password(body);
    const userId = await db.transaction((tx) => createUser(tx, { nama, email, kataSandi }));
    const user = await db.get('SELECT user_id, peran FROM users WHERE user_id = ?', [userId]);
    return { token: issueToken(user), user: await profile(userId) };
  }

  // UC-AKUN-05
  async function login(body) {
    const email = v.email(body);
    const kataSandi = typeof body?.kata_sandi === 'string' ? body.kata_sandi : '';
    if (!kataSandi) throw Errors.validation('kata_sandi', 'Kata sandi wajib diisi.');

    const user = await db.get('SELECT user_id, peran, status_akun, kata_sandi FROM users WHERE email = ?', [email]);
    const ok = await verifyPassword(kataSandi, user?.kata_sandi ?? DUMMY_HASH);
    if (!user || !ok) throw Errors.invalidCredentials();
    if (user.status_akun !== 'aktif') throw Errors.accountDisabled();
    return { token: issueToken(user), user: await profile(user.user_id) };
  }

  /** Middleware autentikasi: memverifikasi token & memuat pengguna aktif (RNF-10). */
  async function authenticate(authorizationHeader) {
    const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader || '');
    if (!match) throw Errors.unauthorized();
    let payload;
    try {
      payload = verifyJwt(match[1], config.jwtSecret, { now: clock.now().getTime() });
    } catch (err) {
      if (err.expired) throw Errors.sessionExpired();
      throw err;
    }
    if (!payload?.sub) throw Errors.unauthorized();
    const user = await db.get('SELECT user_id, nama, email, peran, status_akun FROM users WHERE user_id = ?', [
      payload.sub,
    ]);
    if (!user) throw Errors.unauthorized();
    if (user.status_akun !== 'aktif') throw Errors.accountDisabled();
    return { id: user.user_id, nama: user.nama, email: user.email, peran: user.peran };
  }

  // UC-AKUN-03
  async function updateProfile(userId, body) {
    const nama = v.str(body, 'nama', { label: 'Nama', min: 2, max: 100, optional: true });
    const baru = v.password(body, 'kata_sandi_baru', { optional: true, label: 'Kata sandi baru' });
    if (nama === undefined && baru === undefined) {
      throw Errors.validation('nama', 'Tidak ada perubahan yang dikirim.');
    }
    if (baru !== undefined) {
      const row = await db.get('SELECT kata_sandi FROM users WHERE user_id = ?', [userId]);
      if (!(await verifyPassword(String(body.kata_sandi_lama ?? ''), row.kata_sandi))) {
        throw Errors.wrongPassword();
      }
      await db.run('UPDATE users SET kata_sandi = ? WHERE user_id = ?', [await hashPassword(baru), userId]);
    }
    if (nama !== undefined) await db.run('UPDATE users SET nama = ? WHERE user_id = ?', [nama, userId]);
    return profile(userId);
  }

  // UC-AKUN-04 — data terkait terhapus lewat ON DELETE (ADR-13)
  async function deleteAccount(userId, body) {
    const row = await db.get('SELECT kata_sandi FROM users WHERE user_id = ?', [userId]);
    if (!row) throw Errors.notFound('Akun');
    if (!(await verifyPassword(String(body?.kata_sandi ?? ''), row.kata_sandi))) throw Errors.wrongPassword();
    await db.run('DELETE FROM users WHERE user_id = ?', [userId]);
    return { dihapus: true };
  }

  return { register, login, authenticate, profile, updateProfile, deleteAccount, createUser };
}
