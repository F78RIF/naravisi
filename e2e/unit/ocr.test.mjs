// NaraVisi · e2e/unit/ocr.test.mjs
// Fungsi   : Tes unit PF-06 (Teks di gambar): penyaringan keyakinan < 60, minimal 3 kata bermakna, urutan baris
//            atas→bawah & kiri→kanan, batas 300 karakter, kalimat "Tulisan: …". Ditambah uji Tesseract.js sungguhan
//            (Node, data bahasa lokal extension/vendor/tessdata) pada gambar teks yang digambar kode: satu baris,
//            beberapa baris, tanpa teks.
// Kebutuhan: PF-06
// Pemakaian: cd e2e && npm run test:unit

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  barisDariTesseract, kalimatTulisan, kataBermakna, MAKS_KARAKTER, rapikanTeks, urutkanBaris,
} from '../../extension/shared/ocr.js';

const require = createRequire(import.meta.url);
const baris = (text, y, { x = 10, confidence = 90, h = 20 } = {}) => ({ text, confidence, bbox: { x0: x, y0: y, x1: x + 200, y1: y + h } });

test('PF-06: kata bermakna — huruf/angka, bukan derau simbol', () => {
  for (const k of ['Jakarta', 'BUKA', '2026', 'di', 'Rp25.000', 'ke-3']) assert.ok(kataBermakna(k), k);
  for (const k of ['|', '—', 'a', '~~', '#$%', 'x', 'bcdfghjk']) assert.ok(!kataBermakna(k), k);
});

test('PF-06: baris diurutkan atas→bawah, lalu kiri→kanan untuk baris yang sejajar', () => {
  const acak = [baris('bawah', 200), baris('kanan', 100, { x: 400 }), baris('atas', 10), baris('kiri', 104, { x: 20 })];
  assert.deepEqual(urutkanBaris(acak).map((b) => b.text), ['atas', 'kiri', 'kanan', 'bawah']);
});

test('PF-06: keyakinan < 60 dibuang; kurang dari 3 kata bermakna → tidak dibacakan', () => {
  assert.equal(rapikanTeks([baris('Diskon besar hari ini', 0, { confidence: 45 })]), null);
  assert.equal(rapikanTeks([baris('Diskon besar', 0)]), null); // hanya 2 kata
  assert.equal(rapikanTeks([baris('| — ~ ::', 0)]), null);
  const r = rapikanTeks([baris('Diskon besar', 0), baris('hari ini', 40), baris('%$#@ ~~', 80, { confidence: 30 })]);
  assert.deepEqual(r, { teks: 'Diskon besar hari ini', terpotong: false, kata: 4 });
  assert.equal(kalimatTulisan(r), 'Tulisan: "Diskon besar hari ini".');
});

test('PF-06: kata dengan keyakinan rendah di dalam baris yang yakin juga dibuang', () => {
  const b = { ...baris('Selamat xq datang di NaraVisi', 0), words: [
    { text: 'Selamat', confidence: 95 }, { text: 'xq', confidence: 20 }, { text: 'datang', confidence: 93 },
    { text: 'di', confidence: 90 }, { text: 'NaraVisi', confidence: 88 },
  ] };
  assert.equal(rapikanTeks([b]).teks, 'Selamat datang di NaraVisi');
});

test('PF-06: maks. 300 karakter, sisanya "dan teks lainnya"', () => {
  const panjang = Array.from({ length: 20 }, (_, i) => baris(`Baris ke ${i + 1} berisi kalimat yang cukup panjang`, i * 30));
  const r = rapikanTeks(panjang);
  assert.ok(r.terpotong);
  assert.ok(r.teks.length <= MAKS_KARAKTER);
  assert.ok(!r.teks.endsWith(' '));
  assert.match(kalimatTulisan(r), /^Tulisan: "Baris ke 1 .*" dan teks lainnya\.$/);
  assert.equal(kalimatTulisan(null), null);
  assert.equal(kalimatTulisan({ teks: 'Kata "kutip" di sini', terpotong: false }), `Tulisan: "Kata 'kutip' di sini".`);
});

test('PF-06: hasil Tesseract (blocks → paragraphs → lines → words) diratakan', () => {
  const data = { blocks: [{ paragraphs: [{ lines: [{ text: 'Halo dunia', confidence: 91, bbox: { x0: 0, y0: 0, x1: 9, y1: 9 },
    words: [{ text: 'Halo', confidence: 92 }, { text: 'dunia', confidence: 90 }] }] }] }] };
  assert.deepEqual(barisDariTesseract(data), [{ text: 'Halo dunia', confidence: 91, bbox: { x0: 0, y0: 0, x1: 9, y1: 9 },
    words: [{ text: 'Halo', confidence: 92 }, { text: 'dunia', confidence: 90 }] }]);
  assert.deepEqual(barisDariTesseract(null), []);
});

// ---------------------------------------------------------------------------
// Tesseract.js sungguhan, data bahasa lokal yang sama dengan extension (ind + eng, tessdata_fast)
// ---------------------------------------------------------------------------
const TESSDATA = fileURLToPath(new URL('../../extension/vendor/tessdata', import.meta.url));
const adaData = existsSync(`${TESSDATA}/ind.traineddata.gz`) && existsSync(`${TESSDATA}/eng.traineddata.gz`);

describe('PF-06: Tesseract.js lokal pada gambar teks buatan kode', { skip: adaData ? false : 'data bahasa belum disalin (node scripts/salin-lapis-lokal.mjs)' }, () => {
  let worker;
  const sharp = require('sharp');
  const gambar = (isi, w = 900, h = 320) => sharp(Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#fff"/>${isi}</svg>`,
  )).png().toBuffer();
  const teks = (t, y, size = 44) => `<text x="40" y="${y}" font-family="Arial" font-size="${size}" fill="#111">${t}</text>`;
  const baca = async (png) => {
    const { data } = await worker.recognize(png, {}, { blocks: true, text: false });
    return rapikanTeks(barisDariTesseract(data));
  };

  before(async () => {
    const Tesseract = require('tesseract.js');
    worker = await Tesseract.createWorker(['ind', 'eng'], 1, { langPath: TESSDATA, gzip: true, cacheMethod: 'none' });
  });
  after(async () => worker?.terminate());

  test('satu baris', async () => {
    const r = await baca(await gambar(teks('Selamat datang di perpustakaan', 120)));
    assert.equal(r?.teks, 'Selamat datang di perpustakaan');
  });

  test('beberapa baris, urutan atas → bawah', async () => {
    const r = await baca(await gambar(teks('DISKON AKHIR TAHUN', 80, 52) + teks('Semua buku 30 persen', 170) + teks('Sampai 31 Desember', 250)));
    assert.equal(r?.teks, 'DISKON AKHIR TAHUN Semua buku 30 persen Sampai 31 Desember');
  });

  test('tanpa teks → tidak ada yang dibacakan', async () => {
    const bidang = await sharp({ create: { width: 600, height: 300, channels: 3, background: '#2050e0' } }).png().toBuffer();
    assert.equal(await baca(bidang), null);
    const bentuk = await gambar('<circle cx="200" cy="150" r="90" fill="#e03030"/><rect x="420" y="70" width="160" height="160" fill="#30a050"/>');
    assert.equal(await baca(bentuk), null);
  });
});
