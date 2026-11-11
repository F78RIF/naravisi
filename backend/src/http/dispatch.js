// NaraVisi · backend/src/http/dispatch.js
// Fungsi   : Menjalankan satu rute: autentikasi, cek peran, handler, pemetaan galat.
// Kebutuhan: RNF-06, RNF-09, RNF-10
// Terkait  : routes.js, services/accountService.js (authenticate), lib/errors.js

import { AppError, Errors } from '../lib/errors.js';
import { errorPage } from './pages.js';

// [RNF-09] Autentikasi token — token diperiksa sebelum handler dijalankan
// [RNF-10] Hak akses per peran — rute auth 'admin' → 403 bila peran bukan admin
/** Menjalankan satu rute: autentikasi, peran, handler, pemetaan error. Dipakai semua adaptor. */
export async function dispatch(route, ctx, services) {
  try {
    if (route.auth) {
      ctx.user = await services.accounts.authenticate(ctx.headers?.authorization);
      if (route.auth === 'admin' && ctx.user.peran !== 'admin') throw Errors.forbidden();
    }
    return await route.handler(ctx);
  } catch (err) {
    return errorResult(err, route.path.startsWith('/pay/'));
  }
}

// [RNF-06] Pesan error jelas — AppError → JSON {code, message} berbahasa Indonesia
export function errorResult(err, asHtml = false) {
  if (err instanceof AppError) {
    if (asHtml) return { status: err.status, html: errorPage(err.message) };
    const error = { code: err.code, message: err.message };
    if (err.details) error.details = err.details;
    return { status: err.status, body: { error } };
  }
  console.error(err);
  return { status: 500, body: { error: { code: 'INTERNAL', message: 'Terjadi kesalahan pada server.' } } };
}
