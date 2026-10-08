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

export function loadConfig(env = process.env) {
  const jwtSecret = env.JWT_SECRET || DEV_JWT_SECRET;
  if (jwtSecret === DEV_JWT_SECRET && env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET wajib diisi di produksi.');
  }

  return {
    port: intFromEnv('PORT', 3000),
    publicUrl: (env.PUBLIC_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/+$/, ''),
    aiServiceUrl: (env.AI_SERVICE_URL || 'http://127.0.0.1:8000').replace(/\/+$/, ''),
    aiTimeoutMs: intFromEnv('AI_TIMEOUT_MS', 15000),
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
