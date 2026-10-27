import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { createSqliteDb } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';

describe('Migrasi aman (Tahap 1)', () => {
  it('berkas SQLite lama tanpa kolom jenis_gambar/provider → kolom ditambah, data lama tetap', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nv-mig-'));
    const file = path.join(dir, 'lama.sqlite');
    try {
      const { DatabaseSync } = await import('node:sqlite');
      const old = new DatabaseSync(file);
      old.exec(`CREATE TABLE users (user_id INTEGER PRIMARY KEY AUTOINCREMENT, nama TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
        kata_sandi TEXT NOT NULL, peran TEXT NOT NULL DEFAULT 'pengguna', status_akun TEXT NOT NULL DEFAULT 'aktif', tanggal_registrasi TEXT NOT NULL);
        CREATE TABLE riwayat_deskripsi (riwayat_id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        url_halaman TEXT NULL, url_gambar TEXT NULL, teks_deskripsi TEXT NOT NULL, waktu_dibuat TEXT NOT NULL);
        INSERT INTO users (nama, email, kata_sandi, tanggal_registrasi) VALUES ('Lama', 'lama@uji.id', 'x', '2026-01-01 00:00:00');
        INSERT INTO riwayat_deskripsi (user_id, teks_deskripsi, waktu_dibuat) VALUES (1, 'Deskripsi lama.', '2026-01-01 00:00:00');`);
      old.close();

      const db = await createSqliteDb(file); // menjalankan migrate()
      const row = await db.get('SELECT teks_deskripsi, jenis_gambar, provider FROM riwayat_deskripsi');
      assert.deepEqual({ ...row }, { teks_deskripsi: 'Deskripsi lama.', jenis_gambar: null, provider: null });
      assert.deepEqual(await migrate(db), []); // idempoten
      await db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skema baru sudah memuat kolom → tidak ada yang ditambah', async () => {
    const db = await createSqliteDb(':memory:');
    assert.deepEqual(await migrate(db), []);
    await db.close();
  });
});
