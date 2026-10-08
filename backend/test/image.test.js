import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decodeImagePayload, sniffImageMime } from '../src/lib/image.js';
import { JPEG_HEADER_BASE64, PNG_1PX_BASE64 } from './helpers.js';

const MAX = 1024 * 1024;

describe('decodeImagePayload', () => {
  it('menerima base64 PNG murni', () => {
    const img = decodeImagePayload(PNG_1PX_BASE64, { maxBytes: MAX });
    assert.equal(img.mime, 'image/png');
    assert.ok(img.buffer.length > 0);
  });

  it('menerima data URL dan membuang prefiksnya', () => {
    const img = decodeImagePayload(`data:image/png;base64,${PNG_1PX_BASE64}`, { maxBytes: MAX });
    assert.equal(img.mime, 'image/png');
    assert.equal(img.base64, PNG_1PX_BASE64);
  });

  it('mengenali JPEG dari magic bytes', () => {
    assert.equal(decodeImagePayload(JPEG_HEADER_BASE64, { maxBytes: MAX }).mime, 'image/jpeg');
  });

  it('menolak gambar kosong', () => {
    assert.throws(() => decodeImagePayload('', { maxBytes: MAX }), { code: 'IMAGE_MISSING' });
    assert.throws(() => decodeImagePayload(undefined, { maxBytes: MAX }), { code: 'IMAGE_MISSING' });
  });

  it('menolak base64 rusak', () => {
    assert.throws(() => decodeImagePayload('bukan*base64!', { maxBytes: MAX }), { code: 'IMAGE_INVALID' });
    assert.throws(() => decodeImagePayload(12345, { maxBytes: MAX }), { code: 'IMAGE_INVALID' });
    assert.throws(() => decodeImagePayload('data:image/png,abc', { maxBytes: MAX }), { code: 'IMAGE_INVALID' });
  });

  it('menolak format bukan gambar (mis. teks/SVG)', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>').toString('base64');
    assert.throws(() => decodeImagePayload(svg, { maxBytes: MAX }), { code: 'IMAGE_UNSUPPORTED' });
  });

  it('menolak gambar melebihi batas ukuran', () => {
    const big = Buffer.alloc(2048, 0xff);
    big[0] = 0xff; big[1] = 0xd8; big[2] = 0xff;
    assert.throws(() => decodeImagePayload(big.toString('base64'), { maxBytes: 1024 }), {
      code: 'IMAGE_TOO_LARGE',
    });
  });
});

describe('sniffImageMime', () => {
  it('mengenali GIF dan WebP', () => {
    assert.equal(sniffImageMime(Buffer.from('GIF89a\0\0\0\0\0\0')), 'image/gif');
    assert.equal(sniffImageMime(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')), 'image/webp');
  });
  it('mengembalikan null untuk data pendek/tidak dikenal', () => {
    assert.equal(sniffImageMime(Buffer.from('abc')), null);
    assert.equal(sniffImageMime(Buffer.from('hello world!!')), null);
  });
});
