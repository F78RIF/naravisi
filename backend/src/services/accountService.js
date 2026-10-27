import { Errors } from '../lib/errors.js';
import { signJwt, verifyJwt } from '../lib/jwt.js';
import { DUMMY_HASH, hashPassword, verifyPassword } from '../lib/password.js';
import { createFailureLimiter } from '../lib/rateLimit.js';
import { sqlToIso, toSqlDateTime } from '../lib/time.js';
import * as v from '../lib/validate.js';

/** Akun & profil: RF-01..RF-05 (UC-AKUN-01..05), autentikasi JWT (RNF-09). */
export function createAccountService({ db, config, clock, subscriptions, quota }) {
  // Maksimal 10 login gagal per (email, alamat IP) dalam 15 menit.
  const loginLimiter = createFailureLimiter({ max: 10, windowMs: 15 * 60 * 1000, clock });

  // "reg" = waktu registrasi akun: token akun yang sudah dihapus tidak berlaku untuk akun baru ber-ID sama.
  function issueToken(user) {
    return signJwt({ sub: user.user_id, role: user.peran, reg: String(user.tanggal_registrasi) }, config.jwtSecret, {
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
    const user = await db.get('SELECT user_id, peran, tanggal_registrasi FROM users WHERE user_id = ?', [userId]);
    return { token: issueToken(user), user: await profile(userId) };
  }

  // UC-AKUN-05
  async function login(body, { ip = '-' } = {}) {
    const email = v.email(body);
    const kataSandi = typeof body?.kata_sandi === 'string' ? body.kata_sandi : '';
    if (!kataSandi) throw Errors.validation('kata_sandi', 'Kata sandi wajib diisi.');

    const key = `${email}|${ip}`;
    const wait = loginLimiter.blockedFor(key);
    if (wait > 0) throw Errors.tooManyAttempts(Math.ceil(wait / 60000));

    const user = await db.get('SELECT user_id, peran, status_akun, kata_sandi, tanggal_registrasi FROM users WHERE email = ?', [email]);
    const ok = await verifyPassword(kataSandi, user?.kata_sandi ?? DUMMY_HASH);
    if (!user || !ok) {
      loginLimiter.fail(key);
      throw Errors.invalidCredentials();
    }
    loginLimiter.reset(key);
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
    const user = await db.get('SELECT user_id, nama, email, peran, status_akun, tanggal_registrasi FROM users WHERE user_id = ?', [
      payload.sub,
    ]);
    // Akun terhapus → token dicabut. Token yang terbit sebelum akun ini dibuat (ID dipakai ulang) juga ditolak.
    if (!user) throw Errors.unauthorized();
    if (payload.reg !== undefined && payload.reg !== String(user.tanggal_registrasi)) throw Errors.unauthorized();
    if (user.status_akun !== 'aktif') throw Errors.accountDisabled();
    return { id: user.user_id, nama: user.nama, email: user.email, peran: user.peran };
  }

  // UC-AKUN-03 — nama bebas diubah; email & kata sandi wajib kata sandi saat ini.
  async function updateProfile(userId, body) {
    const nama = v.str(body, 'nama', { label: 'Nama', min: 2, max: 100, optional: true });
    const email = v.email(body, 'email', { optional: true });
    const baru = v.password(body, 'kata_sandi_baru', { optional: true, label: 'Kata sandi baru' });
    if (nama === undefined && email === undefined && baru === undefined) {
      throw Errors.validation('nama', 'Tidak ada perubahan yang dikirim.');
    }
    const row = await db.get('SELECT email, kata_sandi FROM users WHERE user_id = ?', [userId]);
    if (!row) throw Errors.notFound('Akun');
    const emailChanged = email !== undefined && email !== row.email;
    if (emailChanged || baru !== undefined) {
      if (typeof body.kata_sandi_lama !== 'string' || !body.kata_sandi_lama) {
        throw Errors.validation('kata_sandi_lama', 'Masukkan kata sandi saat ini untuk mengganti email atau kata sandi.');
      }
      if (!(await verifyPassword(body.kata_sandi_lama, row.kata_sandi))) throw Errors.wrongPassword();
    }
    if (emailChanged) {
      try {
        await db.run('UPDATE users SET email = ? WHERE user_id = ?', [email, userId]);
      } catch (err) {
        if (err.isDuplicate) throw Errors.emailTaken();
        throw err;
      }
    }
    if (baru !== undefined) await db.run('UPDATE users SET kata_sandi = ? WHERE user_id = ?', [await hashPassword(baru), userId]);
    if (nama !== undefined) await db.run('UPDATE users SET nama = ? WHERE user_id = ?', [nama, userId]);
    return profile(userId);
  }

  // UC-AKUN-04 — konfirmasi ketik "HAPUS" + kata sandi (ADR-19). Profil, pengaturan, kuota, riwayat, dan
  // laporan terhapus lewat ON DELETE CASCADE (ADR-13); token langsung tidak berlaku karena akunnya hilang.
  async function deleteAccount(userId, body) {
    if (typeof body?.konfirmasi !== 'string' || body.konfirmasi.trim() !== 'HAPUS') {
      throw Errors.validation('konfirmasi', 'Ketik HAPUS dengan huruf besar untuk mengonfirmasi penghapusan akun.');
    }
    const row = await db.get('SELECT kata_sandi FROM users WHERE user_id = ?', [userId]);
    if (!row) throw Errors.notFound('Akun');
    if (!(await verifyPassword(String(body?.kata_sandi ?? ''), row.kata_sandi))) throw Errors.wrongPassword();
    await db.run('DELETE FROM users WHERE user_id = ?', [userId]);
    return { dihapus: true };
  }

  return { register, login, authenticate, profile, updateProfile, deleteAccount, createUser };
}
