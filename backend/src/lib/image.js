import { Errors } from './errors.js';

const SIGNATURES = [
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: 'image/png',
    test: (b) =>
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  { mime: 'image/gif', test: (b) => b.subarray(0, 4).toString('ascii') === 'GIF8' },
  {
    mime: 'image/webp',
    test: (b) =>
      b.subarray(0, 4).toString('ascii') === 'RIFF' &&
      b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  { mime: 'image/bmp', test: (b) => b[0] === 0x42 && b[1] === 0x4d },
];

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/** Mengenali format gambar dari magic bytes, bukan dari header yang dikirim klien. */
export function sniffImageMime(buffer) {
  if (!buffer || buffer.length < 12) return null;
  const hit = SIGNATURES.find((s) => s.test(buffer));
  return hit ? hit.mime : null;
}

/**
 * Menerima base64 murni atau data URL ("data:image/png;base64,...").
 * Mengembalikan { buffer, mime, base64 } atau melempar AppError.
 */
export function decodeImagePayload(input, { maxBytes }) {
  if (input === undefined || input === null || input === '') throw Errors.imageMissing();
  if (typeof input !== 'string') throw Errors.imageInvalid();

  let b64 = input.trim();
  if (b64.startsWith('data:')) {
    const comma = b64.indexOf(',');
    if (comma === -1 || !b64.slice(0, comma).includes(';base64')) throw Errors.imageInvalid();
    b64 = b64.slice(comma + 1);
  }
  b64 = b64.replace(/\s+/g, '');

  // Tolak lebih awal sebelum decode: panjang base64 ≈ 4/3 ukuran byte.
  if (Math.floor((b64.length * 3) / 4) > maxBytes + 3) throw Errors.imageTooLarge(maxBytes);
  if (b64.length === 0 || b64.length % 4 !== 0 || !BASE64_RE.test(b64)) {
    throw Errors.imageInvalid();
  }

  const buffer = Buffer.from(b64, 'base64');
  if (buffer.length === 0) throw Errors.imageInvalid();
  if (buffer.length > maxBytes) throw Errors.imageTooLarge(maxBytes);

  const mime = sniffImageMime(buffer);
  if (!mime) throw Errors.imageUnsupported();

  return { buffer, mime, base64: b64 };
}
