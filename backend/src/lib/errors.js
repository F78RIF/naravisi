/**
 * Error aplikasi dengan kode stabil (dipakai extension & dashboard) dan pesan
 * berbahasa Indonesia yang aman dibacakan ke pengguna (RNF-06, RNF-12).
 */
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    if (details) this.details = details;
  }
}

export const Errors = {
  invalidRequest: (msg) => new AppError(400, 'INVALID_REQUEST', msg),
  validation: (field, msg) => new AppError(400, 'VALIDATION_ERROR', msg, { field }),
  notFound: (what = 'Data') => new AppError(404, 'NOT_FOUND', `${what} tidak ditemukan.`),

  // Akun & autentikasi (RF-01..05, RNF-09, RNF-10)
  unauthorized: () => new AppError(401, 'UNAUTHORIZED', 'Silakan login terlebih dahulu.'),
  sessionExpired: () =>
    new AppError(401, 'SESSION_EXPIRED', 'Sesi Anda sudah berakhir. Silakan login kembali.'),
  invalidCredentials: () => new AppError(401, 'INVALID_CREDENTIALS', 'Email atau kata sandi salah.'),
  wrongPassword: () => new AppError(400, 'WRONG_PASSWORD', 'Kata sandi yang dimasukkan salah.'),
  accountDisabled: () =>
    new AppError(403, 'ACCOUNT_DISABLED', 'Akun Anda dinonaktifkan. Hubungi admin NaraVisi.'),
  forbidden: () => new AppError(403, 'FORBIDDEN', 'Anda tidak memiliki akses ke fitur ini.'),
  tooManyAttempts: (minutes) =>
    new AppError(
      429,
      'TOO_MANY_ATTEMPTS',
      `Terlalu banyak percobaan masuk yang gagal. Coba lagi dalam ${minutes} menit.`,
    ),
  payloadTooLarge: () => new AppError(413, 'PAYLOAD_TOO_LARGE', 'Ukuran permintaan terlalu besar.'),
  emailTaken: () =>
    new AppError(409, 'EMAIL_TAKEN', 'Email sudah terdaftar. Gunakan email lain.'),

  // Kuota & Premium
  quotaExceeded: (limit) =>
    new AppError(
      429,
      'QUOTA_EXCEEDED',
      `Kuota harian Anda (${limit} deskripsi) sudah habis. Kuota direset pukul 00.00 WITA, atau upgrade ke Premium untuk kuota tanpa batas.`,
    ),
  premiumRequired: (feature) =>
    new AppError(
      403,
      'PREMIUM_REQUIRED',
      `${feature} hanya tersedia untuk Pengguna Premium. Upgrade ke Premium untuk menggunakannya.`,
    ),
  shortcutConflict: (shortcut) =>
    new AppError(
      409,
      'SHORTCUT_CONFLICT',
      `Pintasan ${shortcut} bentrok dengan pintasan browser atau pembaca layar. Pilih kombinasi lain.`,
    ),

  // Gambar
  imageMissing: () => new AppError(400, 'IMAGE_MISSING', 'Data gambar tidak dikirim.'),
  imageInvalid: () =>
    new AppError(400, 'IMAGE_INVALID', 'Data gambar rusak atau bukan base64 yang valid.'),
  imageTooLarge: (maxBytes) =>
    new AppError(
      413,
      'IMAGE_TOO_LARGE',
      `Ukuran gambar melebihi batas ${Math.round(maxBytes / 1024 / 1024)} MB.`,
    ),
  imageUnsupported: () =>
    new AppError(
      415,
      'IMAGE_UNSUPPORTED',
      'Format gambar tidak didukung. Gunakan JPG, PNG, GIF, WebP, atau BMP.',
    ),

  // Layanan AI
  aiUnavailable: () =>
    new AppError(
      503,
      'AI_UNAVAILABLE',
      'Layanan AI sedang tidak dapat dihubungi. Coba lagi beberapa saat lagi.',
    ),
  aiTimeout: () =>
    new AppError(504, 'AI_TIMEOUT', 'Layanan AI terlalu lama merespons. Coba lagi.'),
  aiFailed: (msg) =>
    new AppError(502, 'AI_FAILED', msg || 'Layanan AI gagal memproses gambar ini.'),
  aiBusy: () =>
    new AppError(503, 'AI_BUSY', 'Layanan AI sedang sibuk atau kuotanya habis. Coba lagi beberapa saat lagi.'),
  aiBlocked: () =>
    new AppError(
      422,
      'AI_BLOCKED',
      'Gambar ini tidak dapat dideskripsikan karena ditahan filter keamanan AI. Kuota Anda tidak terpakai.',
    ),

  // Pembayaran
  paymentGateway: () =>
    new AppError(
      502,
      'PAYMENT_GATEWAY_ERROR',
      'Gagal menghubungi layanan pembayaran. Coba beberapa saat lagi.',
    ),
  invalidSignature: () =>
    new AppError(403, 'INVALID_SIGNATURE', 'Tanda tangan notifikasi pembayaran tidak valid.'),
};
