// NaraVisi · backend/src/http/routes.js
// Fungsi   : Tabel rute REST API (satu sumber untuk Express & node:http): endpoint → service.
// Kebutuhan: RF-01..RF-30
// Terkait  : services/*.js, dispatch.js, docs/API.md

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
  // [RF-26] Status & masa aktif langganan — Premium atau Admin = tanpa batas kuota & riwayat
  const unlimited = async (user) => user.peran === 'admin' || (await s.subscriptions.isPremium(user.id));
  const ok = (body, status = 200) => ({ status, body });

  return [
    // --- Sistem -----------------------------------------------------------
    { method: 'GET', path: '/api/v1/health', handler: async () => ok({ status: 'ok', ai: await s.aiClient.health() }) },

    // --- Akun (RF-01..05) -------------------------------------------------
    // [RF-01] Registrasi akun — POST /auth/register → accounts.register
    { method: 'POST', path: '/api/v1/auth/register', handler: async ({ body }) => ok(await s.accounts.register(body), 201) },
    // [RF-05] Login — POST /auth/login → accounts.login
    { method: 'POST', path: '/api/v1/auth/login', handler: async ({ body, ip }) => ok(await s.accounts.login(body, { ip })) },
    // [RF-02] Lihat profil — GET /me → accounts.profile
    { method: 'GET', path: '/api/v1/me', auth: 'user', handler: async ({ user }) => ok(await s.accounts.profile(user.id)) },
    // [RF-03] Ubah profil — PATCH /me → accounts.updateProfile
    { method: 'PATCH', path: '/api/v1/me', auth: 'user', handler: async ({ user, body }) => ok(await s.accounts.updateProfile(user.id, body)) },
    // [RF-04] Hapus akun — DELETE /me → accounts.deleteAccount
    { method: 'DELETE', path: '/api/v1/me', auth: 'user', handler: async ({ user, body }) => ok(await s.accounts.deleteAccount(user.id, body)) },
    // [RF-26] Status & masa aktif langganan — GET /me/quota → quota.summary (sisa kuota Gratis)
    {
      method: 'GET', path: '/api/v1/me/quota', auth: 'user',
      handler: async ({ user }) => ok(await s.quota.summary(user.id, await unlimited(user))),
    },

    // --- Deskripsi gambar (RF-09..11, RF-13) --------------------------------
    // [RF-09] Mengirim gambar ke AI — POST /descriptions → descriptions.describe
    // [RF-10] Menerima & menyimpan deskripsi — deskripsi disimpan & dikembalikan
    // [RF-11] Menampilkan deskripsi teks — teks dikirim balik untuk ditampilkan
    { method: 'POST', path: '/api/v1/descriptions', auth: 'user', handler: async ({ user, body }) => ok(await s.descriptions.describe(body, user), 201) },

    // --- Riwayat (RF-14..16) ----------------------------------------------
    // [RF-14] Daftar riwayat — GET /history → history.list
    {
      method: 'GET', path: '/api/v1/history', auth: 'user',
      handler: async ({ user, query }) => ok(await s.history.list(user.id, await unlimited(user), query)),
    },
    // [RF-16] Hapus riwayat — DELETE /history (semua) → history.removeAll
    { method: 'DELETE', path: '/api/v1/history', auth: 'user', handler: async ({ user, body }) => ok(await s.history.removeAll(user.id, body)) },
    // [RF-15] Detail riwayat — GET /history/:id → history.get
    {
      method: 'GET', path: '/api/v1/history/:id', auth: 'user',
      handler: async ({ user, params }) => ok(await s.history.get(user.id, await unlimited(user), params.id)),
    },
    // [RF-16] Hapus riwayat — DELETE /history/:id → history.remove
    {
      method: 'DELETE', path: '/api/v1/history/:id', auth: 'user',
      handler: async ({ user, params }) => ok(await s.history.remove(user.id, await unlimited(user), params.id)),
    },

    // --- Pengaturan (RF-17..19) -------------------------------------------
    // [RF-17] Halaman pengaturan — GET /settings → settings.get
    { method: 'GET', path: '/api/v1/settings', auth: 'user', handler: async ({ user }) => ok(await s.settings.get(user.id, await unlimited(user))) },
    // [RF-18] Ubah bahasa & pintasan — PUT /settings → settings.update
    // [RF-19] Ubah kecepatan, nada & suara — PUT /settings → settings.update
    {
      method: 'PUT', path: '/api/v1/settings', auth: 'user',
      handler: async ({ user, body }) => ok(await s.settings.update(user.id, await unlimited(user), body)),
    },

    // --- Laporan (RF-20) --------------------------------------------------
    // [RF-20] Melaporkan deskripsi — POST /reports → reports.create
    {
      method: 'POST', path: '/api/v1/reports', auth: 'user',
      handler: async ({ user, body }) => ok(await s.reports.create(user.id, await unlimited(user), body), 201),
    },

    // --- Premium & pembayaran (RF-23..26) ---------------------------------
    // [RF-23] Daftar paket Premium — GET /plans → payments.listPlans
    { method: 'GET', path: '/api/v1/plans', handler: async () => ok(await s.payments.listPlans()) },
    // [RF-24] Memilih paket — POST /payments → payments.create
    { method: 'POST', path: '/api/v1/payments', auth: 'user', handler: async ({ user, body }) => ok(await s.payments.create(user, body), 201) },
    // [RF-25] Pembayaran & aktivasi Premium — webhook Midtrans → payments.handleNotification
    { method: 'POST', path: '/api/v1/payments/notification', handler: async ({ body }) => ok(await s.payments.handleNotification(body)) },
    // [RF-25] Pembayaran & aktivasi Premium — GET /payments/:orderId → payments.get
    { method: 'GET', path: '/api/v1/payments/:orderId', auth: 'user', handler: async ({ user, params }) => ok(await s.payments.get(user, params.orderId)) },
    // [RF-26] Status & masa aktif langganan — GET /me/subscription → payments.subscription
    { method: 'GET', path: '/api/v1/me/subscription', auth: 'user', handler: async ({ user }) => ok(await s.payments.subscription(user.id)) },

    // --- Admin (RF-21, RF-22, RF-27..30) ----------------------------------
    // [RF-28] Admin: daftar pengguna — GET /admin/users → admin.listUsers
    { method: 'GET', path: '/api/v1/admin/users', auth: 'admin', handler: async ({ query }) => ok(await s.admin.listUsers(query)) },
    // [RF-27] Admin: tambah pengguna — POST /admin/users → admin.createUser
    { method: 'POST', path: '/api/v1/admin/users', auth: 'admin', handler: async ({ body }) => ok(await s.admin.createUser(body), 201) },
    // [RF-28] Admin: daftar pengguna — GET /admin/users/:id → admin.getUser
    { method: 'GET', path: '/api/v1/admin/users/:id', auth: 'admin', handler: async ({ params }) => ok(await s.admin.getUser(params.id)) },
    // [RF-29] Admin: ubah pengguna — PATCH /admin/users/:id → admin.updateUser
    {
      method: 'PATCH', path: '/api/v1/admin/users/:id', auth: 'admin',
      handler: async ({ user, params, body }) => ok(await s.admin.updateUser(user.id, params.id, body)),
    },
    // [RF-30] Admin: hapus pengguna — DELETE /admin/users/:id → admin.deleteUser
    {
      method: 'DELETE', path: '/api/v1/admin/users/:id', auth: 'admin',
      handler: async ({ user, params, body }) => ok(await s.admin.deleteUser(user.id, params.id, body)),
    },
    // [RF-21] Admin: daftar laporan — GET /admin/reports → reports.list
    { method: 'GET', path: '/api/v1/admin/reports', auth: 'admin', handler: async ({ query }) => ok(await s.reports.list(query)) },
    // [RF-22] Admin: ubah status laporan — PATCH /admin/reports/:id → reports.updateStatus
    {
      method: 'PATCH', path: '/api/v1/admin/reports/:id', auth: 'admin',
      handler: async ({ user, params, body }) => ok(await s.reports.updateStatus(user.id, params.id, body)),
    },

    // --- Halaman pembayaran -----------------------------------------------
    // [RF-25] Pembayaran & aktivasi Premium — halaman kembali dari Midtrans
    { method: 'GET', path: '/pay/finish', handler: async () => ({ status: 200, html: finishPage() }) },
    ...(s.config?.appEnv === 'production' ? [] : simulationRoutes(s)),
  ];
}

// [RF-25] Pembayaran & aktivasi Premium — halaman SIMULASI hanya untuk development/tes; production tidak mendaftarkannya
function simulationRoutes(s) {
  return [
    // [RF-25] Pembayaran & aktivasi Premium — halaman bayar SIMULASI (tanpa server key)
    {
      method: 'GET', path: '/pay/simulate/:orderId',
      handler: async ({ params }) => ({ status: 200, html: simulatePage(await s.payments.simulationInfo(params.orderId)) }),
    },
    // [RF-25] Pembayaran & aktivasi Premium — hasil bayar SIMULASI → payments.simulate
    {
      method: 'POST', path: '/pay/simulate/:orderId',
      handler: async ({ params, body }) => ({
        status: 200,
        html: simulateResultPage(await s.payments.simulate(params.orderId, body?.hasil)),
      }),
    },
  ];
}
