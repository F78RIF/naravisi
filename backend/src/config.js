function intFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value) || value <= 0) {
    throw new Error(`Variabel lingkungan ${name} harus bilangan bulat positif, didapat "${raw}"`);
  }
  return value;
}

export function loadConfig() {
  return {
    port: intFromEnv('PORT', 3000),
    aiServiceUrl: (process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000').replace(/\/+$/, ''),
    aiTimeoutMs: intFromEnv('AI_TIMEOUT_MS', 15000),
    maxImageBytes: intFromEnv('MAX_IMAGE_BYTES', 5 * 1024 * 1024),
  };
}
