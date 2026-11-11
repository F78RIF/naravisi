// NaraVisi · backend/src/config.js
// Fungsi   : Membaca variabel lingkungan (.env) menjadi objek konfigurasi.
// Kebutuhan: RNF-09 (JWT_SECRET), RF-25 (Midtrans), RNF-07 (production wajib HTTPS)
// Terkait  : server.js, container.js, .env.example

import { parseAllowedOrigins } from './http/cors.js';

function intFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value) || value <= 0) {
    throw new Error(`Variabel lingkungan ${name} harus bilangan bulat positif, didapat "${raw}"`);
  }
  return value;
}

const DEV_JWT_SECRET = 'naravisi-dev-secret-ganti-di-produksi';
const DEV_ENVS = new Set(['development', 'test']);
export const APP_ENVS = ['development', 'production'];

/** Galat konfigurasi: `problems` berisi daftar variabel yang perlu diperbaiki (dicetak rapi oleh server.js). */
export class ConfigError extends Error {
  constructor(problems) {
    super(`Konfigurasi production belum lengkap:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

/** APP_ENV=development|production; kosong → production bila NODE_ENV=production, selain itu development. */
export function appEnvFrom(env) {
  const raw = (env.APP_ENV || '').trim().toLowerCase();
  if (!raw) return env.NODE_ENV === 'production' ? 'production' : 'development';
  if (!APP_ENVS.includes(raw)) throw new Error(`APP_ENV harus "development" atau "production", didapat "${env.APP_ENV}".`);
  return raw;
}

// [RNF-07] HTTPS/TLS — production wajib PUBLIC_URL https:// dan semua kunci terisi
/**
 * Mode production dipakai orang lain lewat internet: semua kunci wajib ada, alamat publik HTTPS,
 * dan pembayaran memakai Midtrans Sandbox (tanpa halaman simulasi lokal). Semua masalah dilaporkan sekaligus.
 */
function productionProblems(env) {
  const problems = [];
  const secret = env.JWT_SECRET || '';
  if (!secret) problems.push('JWT_SECRET kosong — isi teks acak minimal 32 karakter.');
  else if (secret.length < 32) problems.push(`JWT_SECRET terlalu pendek (${secret.length} karakter) — minimal 32 karakter.`);
  const publicUrl = (env.PUBLIC_URL || '').trim();
  if (!publicUrl) problems.push('PUBLIC_URL kosong — isi alamat publik HTTPS, mis. https://nama.trycloudflare.com');
  else if (!/^https:\/\/[^/\s]+/i.test(publicUrl)) problems.push(`PUBLIC_URL harus diawali https:// (didapat "${publicUrl}").`);
  if (!parseAllowedOrigins(env.ALLOWED_ORIGINS).length) {
    problems.push('ALLOWED_ORIGINS kosong — isi origin extension, mis. chrome-extension://<ID extension>.');
  }
  if (!(env.MIDTRANS_SERVER_KEY || '').trim()) {
    problems.push('MIDTRANS_SERVER_KEY kosong — isi Server Key Sandbox dari dashboard.sandbox.midtrans.com.');
  }
  if (env.MIDTRANS_IS_PRODUCTION === 'true') {
    problems.push('MIDTRANS_IS_PRODUCTION harus false — NaraVisi memakai Midtrans Sandbox (tanpa penagihan uang sungguhan).');
  }
  return problems;
}

export function loadConfig(env = process.env) {
  const appEnv = appEnvFrom(env);
  if (appEnv === 'production') {
    const problems = productionProblems(env);
    if (problems.length) throw new ConfigError(problems);
  }

  const jwtSecret = env.JWT_SECRET || DEV_JWT_SECRET;
  // Kunci cadangan ada di repo publik, jadi hanya boleh dipakai saat pengembangan/tes.
  if (jwtSecret === DEV_JWT_SECRET && !DEV_ENVS.has(env.NODE_ENV)) {
    throw new Error('JWT_SECRET wajib diisi di .env (kosong hanya boleh bila NODE_ENV=development atau test).');
  }
  if (env.NODE_ENV === 'production' && jwtSecret.length < 32) {
    throw new Error('JWT_SECRET di produksi minimal 32 karakter.');
  }

  return {
    appEnv,
    port: intFromEnv('PORT', 3000),
    // Origin yang boleh memanggil API dari browser (mis. chrome-extension://<ID>); kosong = localhost saja.
    allowedOrigins: parseAllowedOrigins(env.ALLOWED_ORIGINS),
    publicUrl: (env.PUBLIC_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/+$/, ''),
    aiServiceUrl: (env.AI_SERVICE_URL || 'http://127.0.0.1:8000').replace(/\/+$/, ''),
    aiTimeoutMs: intFromEnv('AI_TIMEOUT_MS', 25000),
    maxImageBytes: intFromEnv('MAX_IMAGE_BYTES', 5 * 1024 * 1024),

    jwtSecret,
    jwtExpiresDays: intFromEnv('JWT_EXPIRES_DAYS', 7),

    timeZone: env.APP_TZ || 'Asia/Makassar',
    freeDailyQuota: intFromEnv('FREE_DAILY_QUOTA', 10),
    freeHistoryDays: intFromEnv('FREE_HISTORY_DAYS', 7),

    db: {
      driver: (env.DB_DRIVER || 'mysql').toLowerCase(),
      host: env.MYSQL_HOST || '127.0.0.1',
      port: intFromEnv('MYSQL_PORT', 3306),
      user: env.MYSQL_USER || 'root',
      password: env.MYSQL_PASSWORD || '',
      database: env.MYSQL_DATABASE || 'naravisi',
      sqlitePath: env.SQLITE_PATH || './data/naravisi.sqlite',
    },

    midtrans: {
      serverKey: env.MIDTRANS_SERVER_KEY || '',
      isProduction: env.MIDTRANS_IS_PRODUCTION === 'true',
    },
  };
}
