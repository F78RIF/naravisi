-- Skema basis data NaraVisi v1.1 — MySQL 8.4 LTS
-- Sesuai ERD SDD v1.1 (perubahan dari v1.0: lihat docs/KEPUTUSAN.md ADR-09, ADR-13, W6).

CREATE TABLE IF NOT EXISTS users (
  user_id            INT AUTO_INCREMENT PRIMARY KEY,
  nama               VARCHAR(100) NOT NULL,
  email              VARCHAR(100) NOT NULL,
  kata_sandi         VARCHAR(255) NOT NULL,
  peran              ENUM('pengguna','admin') NOT NULL DEFAULT 'pengguna',
  status_akun        ENUM('aktif','nonaktif') NOT NULL DEFAULT 'aktif',
  tanggal_registrasi DATETIME NOT NULL,
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pengaturan_aksesibilitas (
  pengaturan_id      INT AUTO_INCREMENT PRIMARY KEY,
  user_id            INT NOT NULL,
  bahasa_deskripsi   VARCHAR(10) NOT NULL DEFAULT 'id',
  pintasan_keyboard  VARCHAR(50) NOT NULL DEFAULT 'Alt+Shift+N',
  kecepatan_suara    DECIMAL(3,1) NOT NULL DEFAULT 1.0,
  nada_suara         DECIMAL(3,1) NOT NULL DEFAULT 1.0,
  jenis_suara        VARCHAR(100) NULL,
  UNIQUE KEY uq_pengaturan_user (user_id),
  CONSTRAINT fk_pengaturan_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS kuota_harian (
  kuota_id           INT AUTO_INCREMENT PRIMARY KEY,
  user_id            INT NOT NULL,
  tanggal            DATE NOT NULL,
  jumlah_permintaan  INT NOT NULL DEFAULT 0,
  UNIQUE KEY uq_kuota_user_tanggal (user_id, tanggal),
  CONSTRAINT fk_kuota_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS riwayat_deskripsi (
  riwayat_id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id            INT NOT NULL,
  url_halaman        TEXT NULL,
  url_gambar         TEXT NULL,
  teks_deskripsi     TEXT NOT NULL,
  waktu_dibuat       DATETIME NOT NULL,
  KEY idx_riwayat_user_waktu (user_id, waktu_dibuat),
  CONSTRAINT fk_riwayat_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS laporan_deskripsi (
  laporan_id         INT AUTO_INCREMENT PRIMARY KEY,
  riwayat_id         INT NOT NULL,
  user_id            INT NOT NULL,
  admin_id           INT NULL,
  alasan             TEXT NOT NULL,
  status_laporan     ENUM('baru','ditinjau') NOT NULL DEFAULT 'baru',
  tindak_lanjut      TEXT NULL,
  tanggal_laporan    DATETIME NOT NULL,
  tanggal_tinjau     DATETIME NULL,
  KEY idx_laporan_status (status_laporan, tanggal_laporan),
  CONSTRAINT fk_laporan_riwayat FOREIGN KEY (riwayat_id) REFERENCES riwayat_deskripsi(riwayat_id) ON DELETE CASCADE,
  CONSTRAINT fk_laporan_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT fk_laporan_admin FOREIGN KEY (admin_id) REFERENCES users(user_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS paket_premium (
  paket_id           INT AUTO_INCREMENT PRIMARY KEY,
  nama_paket         VARCHAR(50) NOT NULL,
  harga              DECIMAL(10,2) NOT NULL,
  durasi_hari        INT NOT NULL,
  manfaat            TEXT NOT NULL,
  aktif              TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS transaksi (
  transaksi_id       INT AUTO_INCREMENT PRIMARY KEY,
  user_id            INT NULL,
  paket_id           INT NOT NULL,
  order_id           VARCHAR(100) NOT NULL,
  metode_pembayaran  VARCHAR(30) NULL,
  jumlah             DECIMAL(10,2) NOT NULL,
  status_pembayaran  ENUM('menunggu','berhasil','gagal','kedaluwarsa') NOT NULL DEFAULT 'menunggu',
  waktu_transaksi    DATETIME NOT NULL,
  waktu_bayar        DATETIME NULL,
  UNIQUE KEY uq_transaksi_order (order_id),
  CONSTRAINT fk_transaksi_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL,
  CONSTRAINT fk_transaksi_paket FOREIGN KEY (paket_id) REFERENCES paket_premium(paket_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS langganan (
  langganan_id       INT AUTO_INCREMENT PRIMARY KEY,
  user_id            INT NOT NULL,
  paket_id           INT NOT NULL,
  transaksi_id       INT NULL,
  tanggal_mulai      DATE NOT NULL,
  tanggal_berakhir   DATE NOT NULL,
  UNIQUE KEY uq_langganan_transaksi (transaksi_id),
  KEY idx_langganan_user_akhir (user_id, tanggal_berakhir),
  CONSTRAINT fk_langganan_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT fk_langganan_paket FOREIGN KEY (paket_id) REFERENCES paket_premium(paket_id),
  CONSTRAINT fk_langganan_transaksi FOREIGN KEY (transaksi_id) REFERENCES transaksi(transaksi_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
