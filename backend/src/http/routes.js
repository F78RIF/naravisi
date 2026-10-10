import { finishPage, simulatePage, simulateResultPage } from './pages.js';

/**
 * Tabel rute REST API NaraVisi — satu sumber kebenaran untuk adaptor Express
 * (produksi) dan adaptor node:http (pengujian). Lihat docs/API.md.
 *
 * auth: undefined = publik, 'user' = wajib login, 'admin' = wajib Admin.
 * handler(ctx) → { status, body } | { status, html }
 */
/** Rute yang menerima gambar base64 berukuran besar; rute lain dibatasi 32 KB. */
export const LARGE_BODY_PATHS = new Set(['/api/v1/descriptions']);
export const SMALL_BODY_LIMIT = 32 * 1024;

/** Kebijakan keamanan konten untuk halaman HTML (Dashboard Admin & halaman pembayaran). */
export const HTML_SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'X-Frame-Options': 'DENY',
};

export function buildRoutes(s) {
  const unlimited = async (user) => user.peran === 'admin' || (await s.subscriptions.isPremium(user.id));
  const ok = (body, status = 200) => ({ status, body });

  return [
    // --- Sistem -----------------------------------------------------------
    { method: 'GET', path: '/api/v1/health', handler: async () => ok({ status: 'ok', ai: await s.aiClient.health() }) },

    // --- Akun (RF-01..05) -------------------------------------------------
    { method: 'POST', path: '/api/v1/auth/register', handler: async ({ body }) => ok(await s.accounts.register(body), 201) },
    { method: 'POST', path: '/api/v1/auth/login', handler: async ({ body, ip }) => ok(await s.accounts.login(body, { ip })) },
    { method: 'GET', path: '/api/v1/me', auth: 'user', handler: async ({ user }) => ok(await s.accounts.profile(user.id)) },
    { method: 'PATCH', path: '/api/v1/me', auth: 'user', handler: async ({ user, body }) => ok(await s.accounts.updateProfile(user.id, body)) },
    { method: 'DELETE', path: '/api/v1/me', auth: 'user', handler: async ({ user, body }) => ok(await s.accounts.deleteAccount(user.id, body)) },
    {
      method: 'GET', path: '/api/v1/me/quota', auth: 'user',
      handler: async ({ user }) => ok(await s.quota.summary(user.id, await unlimited(user))),
    },

    // --- Deskripsi gambar (RF-09..11, RF-13) --------------------------------
    { method: 'POST', path: '/api/v1/descriptions', auth: 'user', handler: async ({ user, body }) => ok(await s.descriptions.describe(body, user), 201) },

    // --- Riwayat (RF-14..16) ----------------------------------------------
    {
      method: 'GET', path: '/api/v1/history', auth: 'user',
      handler: async ({ user, query }) => ok(await s.history.list(user.id, await unlimited(user), query)),
    },
    {
      method: 'GET', path: '/api/v1/history/:id', auth: 'user',
      handler: async ({ user, params }) => ok(await s.history.get(user.id, await unlimited(user), params.id)),
    },
    {
      method: 'DELETE', path: '/api/v1/history/:id', auth: 'user',
      handler: async ({ user, params }) => ok(await s.history.remove(user.id, await unlimited(user), params.id)),
    },

    // --- Pengaturan (RF-17..19) -------------------------------------------
    { method: 'GET', path: '/api/v1/settings', auth: 'user', handler: async ({ user }) => ok(await s.settings.get(user.id, await unlimited(user))) },
    {
      method: 'PUT', path: '/api/v1/settings', auth: 'user',
      handler: async ({ user, body }) => ok(await s.settings.update(user.id, await unlimited(user), body)),
    },

    // --- Laporan (RF-20) --------------------------------------------------
    {
      method: 'POST', path: '/api/v1/reports', auth: 'user',
      handler: async ({ user, body }) => ok(await s.reports.create(user.id, await unlimited(user), body), 201),
    },

    // --- Premium & pembayaran (RF-23..26) ---------------------------------
    { method: 'GET', path: '/api/v1/plans', handler: async () => ok(await s.payments.listPlans()) },
    { method: 'POST', path: '/api/v1/payments', auth: 'user', handler: async ({ user, body }) => ok(await s.payments.create(user, body), 201) },
    { method: 'POST', path: '/api/v1/payments/notification', handler: async ({ body }) => ok(await s.payments.handleNotification(body)) },
    { method: 'GET', path: '/api/v1/payments/:orderId', auth: 'user', handler: async ({ user, params }) => ok(await s.payments.get(user, params.orderId)) },
    { method: 'GET', path: '/api/v1/me/subscription', auth: 'user', handler: async ({ user }) => ok(await s.payments.subscription(user.id)) },

    // --- Admin (RF-21, RF-22, RF-27..30) ----------------------------------
    { method: 'GET', path: '/api/v1/admin/users', auth: 'admin', handler: async ({ query }) => ok(await s.admin.listUsers(query)) },
    { method: 'POST', path: '/api/v1/admin/users', auth: 'admin', handler: async ({ body }) => ok(await s.admin.createUser(body), 201) },
    { method: 'GET', path: '/api/v1/admin/users/:id', auth: 'admin', handler: async ({ params }) => ok(await s.admin.getUser(params.id)) },
    {
      method: 'PATCH', path: '/api/v1/admin/users/:id', auth: 'admin',
      handler: async ({ user, params, body }) => ok(await s.admin.updateUser(user.id, params.id, body)),
    },
    {
      method: 'DELETE', path: '/api/v1/admin/users/:id', auth: 'admin',
      handler: async ({ user, params }) => ok(await s.admin.deleteUser(user.id, params.id)),
    },
    { method: 'GET', path: '/api/v1/admin/reports', auth: 'admin', handler: async ({ query }) => ok(await s.reports.list(query)) },
    {
      method: 'PATCH', path: '/api/v1/admin/reports/:id', auth: 'admin',
      handler: async ({ user, params, body }) => ok(await s.reports.updateStatus(user.id, params.id, body)),
    },

    // --- Halaman pembayaran -----------------------------------------------
    { method: 'GET', path: '/pay/finish', handler: async () => ({ status: 200, html: finishPage() }) },
    {
      method: 'GET', path: '/pay/simulate/:orderId',
      handler: async ({ params }) => ({ status: 200, html: simulatePage(await s.payments.simulationInfo(params.orderId)) }),
    },
    {
      method: 'POST', path: '/pay/simulate/:orderId',
      handler: async ({ params, body }) => ({
        status: 200,
        html: simulateResultPage(await s.payments.simulate(params.orderId, body?.hasil)),
      }),
    },
  ];
}
