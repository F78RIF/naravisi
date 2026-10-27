import { readFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from './migrate.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Antarmuka basis data yang dipakai seluruh service:
 *   all(sql, params)  → array baris
 *   get(sql, params)  → satu baris atau undefined
 *   run(sql, params)  → { insertId, changes }
 *   transaction(fn)   → menjalankan fn(tx) dalam satu transaksi
 * Error duplikat (UNIQUE) ditandai err.isDuplicate = true.
 * Query hanya memakai SQL yang kompatibel MySQL & SQLite (placeholder "?").
 */

function normParams(params = []) {
  return params.map((v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));
}

// ---------------------------------------------------------------------------
// SQLite (node:sqlite, bawaan Node.js ≥ 22.5) — uji otomatis & demo cepat
// ---------------------------------------------------------------------------
export async function createSqliteDb(filename = ':memory:') {
  const { DatabaseSync } = await import('node:sqlite');
  if (filename !== ':memory:') mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  const raw = new DatabaseSync(filename);
  raw.exec('PRAGMA foreign_keys = ON;');
  raw.exec(readFileSync(path.join(here, 'schema.sqlite.sql'), 'utf8'));

  const wrapError = (err) => {
    if (/UNIQUE constraint failed/i.test(err?.message || '')) err.isDuplicate = true;
    return err;
  };

  const api = {
    driver: 'sqlite',
    async all(sql, params) {
      try {
        return raw.prepare(sql).all(...normParams(params));
      } catch (err) {
        throw wrapError(err);
      }
    },
    async get(sql, params) {
      try {
        return raw.prepare(sql).get(...normParams(params));
      } catch (err) {
        throw wrapError(err);
      }
    },
    async run(sql, params) {
      try {
        const res = raw.prepare(sql).run(...normParams(params));
        return { insertId: Number(res.lastInsertRowid), changes: Number(res.changes) };
      } catch (err) {
        throw wrapError(err);
      }
    },
    async close() {
      raw.close();
    },
  };

  // Satu koneksi: transaksi diantrikan agar tidak saling tumpang tindih.
  let queue = Promise.resolve();
  api.transaction = (fn) => {
    const job = queue.then(async () => {
      raw.exec('BEGIN');
      try {
        const result = await fn(api);
        raw.exec('COMMIT');
        return result;
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      }
    });
    queue = job.catch(() => {});
    return job;
  };
  await migrate(api); // berkas SQLite lama: tambah kolom baru
  return api;
}

// ---------------------------------------------------------------------------
// MySQL 8.4 (mysql2) — basis data utama sesuai SRS 2.4
// ---------------------------------------------------------------------------
export async function createMysqlDb(cfg) {
  const mysql = (await import('mysql2/promise')).default;
  const pool = mysql.createPool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    connectionLimit: 10,
    dateStrings: true, // DATE/DATETIME dikembalikan sebagai string, sama seperti SQLite
    timezone: 'Z',
    decimalNumbers: true,
    charset: 'utf8mb4',
  });

  const wrapError = (err) => {
    if (err?.code === 'ER_DUP_ENTRY') err.isDuplicate = true;
    return err;
  };

  const make = (conn) => ({
    driver: 'mysql',
    async all(sql, params) {
      try {
        const [rows] = await conn.query(sql, normParams(params));
        return rows;
      } catch (err) {
        throw wrapError(err);
      }
    },
    async get(sql, params) {
      const rows = await this.all(sql, params);
      return rows[0];
    },
    async run(sql, params) {
      try {
        const [res] = await conn.query(sql, normParams(params));
        return { insertId: res.insertId, changes: res.affectedRows };
      } catch (err) {
        throw wrapError(err);
      }
    },
  });

  const api = make(pool);
  api.transaction = async (fn) => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await fn(make(conn));
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  };
  api.close = () => pool.end();
  return api;
}

export async function createDb(dbConfig) {
  if (dbConfig.driver === 'sqlite') return createSqliteDb(dbConfig.sqlitePath);
  if (dbConfig.driver === 'mysql') {
    const db = await createMysqlDb(dbConfig);
    const added = await migrate(db); // MySQL lama: tambah kolom baru (boleh NULL), data tetap
    if (added.length) console.log(`✔ Migrasi: kolom ${added.join(', ')} ditambahkan.`);
    return db;
  }
  throw new Error(`DB_DRIVER tidak dikenal: ${dbConfig.driver} (pilih mysql atau sqlite)`);
}

export function mysqlSchemaSql() {
  return readFileSync(path.join(here, 'schema.mysql.sql'), 'utf8');
}
