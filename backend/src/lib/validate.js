import { Errors } from './errors.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function str(body, field, { label, min = 1, max = 255, optional = false } = {}) {
  const raw = body?.[field];
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
    if (optional) return undefined;
    throw Errors.validation(field, `${label} wajib diisi.`);
  }
  if (typeof raw !== 'string') throw Errors.validation(field, `${label} harus berupa teks.`);
  const value = raw.trim();
  if (value.length < min) throw Errors.validation(field, `${label} minimal ${min} karakter.`);
  if (value.length > max) throw Errors.validation(field, `${label} maksimal ${max} karakter.`);
  return value;
}

export function email(body, field = 'email', { optional = false } = {}) {
  const value = str(body, field, { label: 'Email', max: 100, optional });
  if (value === undefined) return undefined;
  if (!EMAIL_RE.test(value)) throw Errors.validation(field, 'Format email tidak valid.');
  return value.toLowerCase();
}

export function password(body, field = 'kata_sandi', { optional = false, label = 'Kata sandi' } = {}) {
  const raw = body?.[field];
  if (raw === undefined || raw === null || raw === '') {
    if (optional) return undefined;
    throw Errors.validation(field, `${label} wajib diisi.`);
  }
  if (typeof raw !== 'string') throw Errors.validation(field, `${label} harus berupa teks.`);
  if (raw.length < 8) throw Errors.validation(field, `${label} minimal 8 karakter.`);
  if (raw.length > 72) throw Errors.validation(field, `${label} maksimal 72 karakter.`);
  return raw;
}

export function oneOf(body, field, allowed, { label, optional = false } = {}) {
  const raw = body?.[field];
  if (raw === undefined || raw === null) {
    if (optional) return undefined;
    throw Errors.validation(field, `${label} wajib diisi.`);
  }
  if (!allowed.includes(raw)) {
    throw Errors.validation(field, `${label} harus salah satu dari: ${allowed.join(', ')}.`);
  }
  return raw;
}

export function num(body, field, { label, min, max, optional = false } = {}) {
  const raw = body?.[field];
  if (raw === undefined || raw === null || raw === '') {
    if (optional) return undefined;
    throw Errors.validation(field, `${label} wajib diisi.`);
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) throw Errors.validation(field, `${label} harus berupa angka.`);
  if (value < min || value > max) {
    throw Errors.validation(field, `${label} harus di antara ${min} dan ${max}.`);
  }
  return Math.round(value * 10) / 10;
}

export function id(value, what = 'Data') {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw Errors.notFound(what);
  return n;
}

export function pagination(query, { maxLimit = 50, defaultLimit = 20 } = {}) {
  const page = Math.max(1, Number.parseInt(query?.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, Number.parseInt(query?.limit, 10) || defaultLimit));
  return { page, limit, offset: (page - 1) * limit };
}
