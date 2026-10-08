/**
 * Error aplikasi dengan kode stabil (dipakai extension) dan pesan
 * berbahasa Indonesia yang aman dibacakan ke pengguna (RNF-06, RNF-12).
 */
export class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

export const Errors = {
  invalidRequest: (msg) => new AppError(400, 'INVALID_REQUEST', msg),
  imageMissing: () =>
    new AppError(400, 'IMAGE_MISSING', 'Data gambar tidak dikirim.'),
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
};
