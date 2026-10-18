-- Padanan SQLite dari schema.mysql.sql — dipakai pengujian otomatis dan demo cepat
-- (DB_DRIVER=sqlite). Struktur tabel, kolom, dan aturan ON DELETE identik.

CREATE TABLE IF NOT EXISTS users (
  user_id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nama               TEXT NOT NULL,
  email              TEXT NOT NULL UNIQUE,
  kata_sandi         TEXT NOT NULL,
  peran              TEXT NOT NULL DEFAULT 'pengguna' CHECK (peran IN ('pengguna','admin')),
  status_akun        TEXT NOT NULL DEFAULT 'aktif' CHECK (status_akun IN ('aktif','nonaktif')),
  tanggal_registrasi TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pengaturan_aksesibilitas (
  pengaturan_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id            INTEGER NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE CASCADE,
  bahasa_deskripsi   TEXT NOT NULL DEFAULT 'id',
  pintasan_keyboard  TEXT NOT NULL DEFAULT 'Alt+Shift+K',
  kecepatan_suara    REAL NOT NULL DEFAULT 1.0,
  nada_suara         REAL NOT NULL DEFAULT 1.0,
  jenis_suara        TEXT NULL
);

CREATE TABLE IF NOT EXISTS kuota_harian (
  kuota_id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id            INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  tanggal            TEXT NOT NULL,
  jumlah_permintaan  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, tanggal)
);

CREATE TABLE IF NOT EXISTS riwayat_deskripsi (
  riwayat_id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id            INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  url_halaman        TEXT NULL,
  url_gambar         TEXT NULL,
  teks_deskripsi     TEXT NOT NULL,
  waktu_dibuat       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_riwayat_user_waktu ON riwayat_deskripsi (user_id, waktu_dibuat);

CREATE TABLE IF NOT EXISTS laporan_deskripsi (
  laporan_id         INTEGER PRIMARY KEY AUTOINCREMENT,
  riwayat_id         INTEGER NOT NULL REFERENCES riwayat_deskripsi(riwayat_id) ON DELETE CASCADE,
  user_id            INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  admin_id           INTEGER NULL REFERENCES users(user_id) ON DELETE SET NULL,
  alasan             TEXT NOT NULL,
  status_laporan     TEXT NOT NULL DEFAULT 'baru' CHECK (status_laporan IN ('baru','ditinjau')),
  tindak_lanjut      TEXT NULL,
  tanggal_laporan    TEXT NOT NULL,
  tanggal_tinjau     TEXT NULL
);
CREATE INDEX IF NOT EXISTS idx_laporan_status ON laporan_deskripsi (status_laporan, tanggal_laporan);

CREATE TABLE IF NOT EXISTS paket_premium (
  paket_id           INTEGER PRIMARY KEY AUTOINCREMENT,
  nama_paket         TEXT NOT NULL,
  harga              REAL NOT NULL,
  durasi_hari        INTEGER NOT NULL,
  manfaat            TEXT NOT NULL,
  aktif              INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS transaksi (
  transaksi_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id            INTEGER NULL REFERENCES users(user_id) ON DELETE SET NULL,
  paket_id           INTEGER NOT NULL REFERENCES paket_premium(paket_id),
  order_id           TEXT NOT NULL UNIQUE,
  metode_pembayaran  TEXT NULL,
  jumlah             REAL NOT NULL,
  status_pembayaran  TEXT NOT NULL DEFAULT 'menunggu'
                     CHECK (status_pembayaran IN ('menunggu','berhasil','gagal','kedaluwarsa')),
  waktu_transaksi    TEXT NOT NULL,
  waktu_bayar        TEXT NULL
);

CREATE TABLE IF NOT EXISTS langganan (
  langganan_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id            INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  paket_id           INTEGER NOT NULL REFERENCES paket_premium(paket_id),
  transaksi_id       INTEGER NULL UNIQUE REFERENCES transaksi(transaksi_id) ON DELETE SET NULL,
  tanggal_mulai      TEXT NOT NULL,
  tanggal_berakhir   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_langganan_user_akhir ON langganan (user_id, tanggal_berakhir);
