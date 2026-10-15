// CORS: hanya origin yang diizinkan (ALLOWED_ORIGINS) yang mendapat header Allow-Origin.
// Extension memanggil API dari service worker dengan host_permissions, jadi tidak bergantung pada CORS;
// pembatasan ini mencegah situs web lain memakai API dari browser pengguna.

const LOCALHOST_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/** "chrome-extension://abc, http://x" → ['chrome-extension://abc', 'http://x'] */
export function parseAllowedOrigins(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

/** Daftar kosong (development) = hanya http://localhost dan http://127.0.0.1. */
export function isOriginAllowed(origin, allowedOrigins) {
  if (!origin) return false;
  if (!allowedOrigins.length) return LOCALHOST_RE.test(origin);
  return allowedOrigins.includes(origin);
}

/** Header CORS untuk respons API; objek kosong bila origin tidak diizinkan. */
export function corsHeaders(origin, allowedOrigins) {
  const headers = { Vary: 'Origin' };
  if (!isOriginAllowed(origin, allowedOrigins)) return headers;
  return {
    ...headers,
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'content-type, authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  };
}
