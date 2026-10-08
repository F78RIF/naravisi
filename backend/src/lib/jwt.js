import { createHmac, timingSafeEqual } from 'node:crypto';

// JWT HS256 minimal (RNF-09) memakai modul crypto bawaan Node.js.

const b64url = (buf) => Buffer.from(buf).toString('base64url');

export function signJwt(payload, secret, { expiresInSeconds, now = Date.now() } = {}) {
  const iat = Math.floor(now / 1000);
  const body = { ...payload, iat };
  if (expiresInSeconds) body.exp = iat + expiresInSeconds;
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const content = b64url(JSON.stringify(body));
  const signature = createHmac('sha256', secret).update(`${header}.${content}`).digest('base64url');
  return `${header}.${content}.${signature}`;
}

/** Mengembalikan payload, atau null bila token rusak / tanda tangan salah. Melempar 'expired'. */
export function verifyJwt(token, secret, { now = Date.now() } = {}) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, content, signature] = parts;

  const expected = createHmac('sha256', secret).update(`${header}.${content}`).digest();
  let given;
  try {
    given = Buffer.from(signature, 'base64url');
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  let payload;
  try {
    const head = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
    if (head.alg !== 'HS256') return null;
    payload = JSON.parse(Buffer.from(content, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (payload.exp && Math.floor(now / 1000) >= payload.exp) {
    const err = new Error('expired');
    err.expired = true;
    throw err;
  }
  return payload;
}
