import { AppError, Errors } from '../lib/errors.js';
import { errorPage } from './pages.js';

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
