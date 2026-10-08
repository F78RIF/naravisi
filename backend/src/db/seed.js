import { hashPassword } from '../lib/password.js';
import { toSqlDateTime } from '../lib/time.js';

// ADR-11: satu paket Bulanan, Rp15.000 / 30 hari.
export const DEFAULT_PLANS = [
  {
    nama_paket: 'Bulanan',
    harga: 15000,
    durasi_hari: 30,
    manfaat: [
      'Kuota deskripsi gambar tanpa batas',
      'Pilih semua jenis suara yang tersedia di perangkat',
      'Atur nada suara',
      'Riwayat deskripsi penuh (tidak terbatas 7 hari)',
    ].join('\n'),
  },
];

export async function seedPlans(db) {
  const row = await db.get('SELECT COUNT(*) AS n FROM paket_premium');
  if (Number(row.n) > 0) return 0;
  for (const p of DEFAULT_PLANS) {
    await db.run('INSERT INTO paket_premium (nama_paket, harga, durasi_hari, manfaat, aktif) VALUES (?, ?, ?, ?, 1)', [
      p.nama_paket,
      p.harga,
      p.durasi_hari,
      p.manfaat,
    ]);
  }
  return DEFAULT_PLANS.length;
}

export async function seedAdmin(db, { nama, email, password }) {
  const exists = await db.get('SELECT user_id FROM users WHERE email = ?', [email.toLowerCase()]);
  if (exists) return false;
  const res = await db.run(
    'INSERT INTO users (nama, email, kata_sandi, peran, status_akun, tanggal_registrasi) VALUES (?, ?, ?, ?, ?, ?)',
    [nama, email.toLowerCase(), await hashPassword(password), 'admin', 'aktif', toSqlDateTime()],
  );
  await db.run('INSERT INTO pengaturan_aksesibilitas (user_id) VALUES (?)', [res.insertId]);
  return true;
}
