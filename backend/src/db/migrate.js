/**
 * Migrasi aman untuk basis data yang sudah ada: hanya MENAMBAH kolom yang boleh NULL,
 * tidak pernah menghapus atau mengubah data. Dijalankan setiap start (idempoten).
 * Skema baru (schema.*.sql) sudah memuat kolom ini; daftar di bawah untuk basis data lama.
 */
export const ADDED_COLUMNS = [
  // Tahap 1 (ADR-22): jenis gambar dari Gemini & provider yang benar-benar dipakai.
  { table: 'riwayat_deskripsi', column: 'jenis_gambar', mysql: 'VARCHAR(30) NULL', sqlite: 'TEXT NULL' },
  { table: 'riwayat_deskripsi', column: 'provider', mysql: 'VARCHAR(30) NULL', sqlite: 'TEXT NULL' },
  // Tahap 3 (RF-20): kategori alasan laporan yang dipilih pengguna.
  { table: 'laporan_deskripsi', column: 'kategori', mysql: 'VARCHAR(30) NULL', sqlite: 'TEXT NULL' },
];

async function existingColumns(db, table) {
  if (db.driver === 'sqlite') {
    return (await db.all(`PRAGMA table_info(${table})`)).map((r) => r.name);
  }
  const rows = await db.all(
    'SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
    [table],
  );
  return rows.map((r) => r.name);
}

/** Mengembalikan daftar "tabel.kolom" yang baru ditambahkan. */
export async function migrate(db) {
  const added = [];
  const cache = new Map();
  for (const { table, column, mysql, sqlite } of ADDED_COLUMNS) {
    if (!cache.has(table)) cache.set(table, await existingColumns(db, table));
    const cols = cache.get(table);
    if (!cols.length || cols.includes(column)) continue; // tabel belum dibuat (db:setup) atau kolom sudah ada
    await db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${db.driver === 'sqlite' ? sqlite : mysql}`);
    cols.push(column);
    added.push(`${table}.${column}`);
  }
  return added;
}
