// NaraVisi · e2e/unit/warna.test.mjs
// Fungsi   : Tes unit PF-08 (Warna dominan): median-cut, nama warna Indonesia, ambang porsi 15%, maks. 2 warna, kalimat.
//            Logika murni di extension/shared/warna.js, jadi cukup Node tanpa browser.
// Kebutuhan: PF-08
// Pemakaian: cd e2e && npm run test:unit

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { kalimatWarna, kuantisasi, namaWarna, warnaDominan } from '../../extension/shared/warna.js';

const kamus = JSON.parse(readFileSync(new URL('../../extension/shared/warna-id.json', import.meta.url), 'utf8'));
const SISI = 64;

/** Gambar RGBA 64×64; `isi(x, y)` → [r, g, b] atau [r, g, b, a]. */
function gambar(isi) {
  const data = new Uint8ClampedArray(SISI * SISI * 4);
  for (let y = 0; y < SISI; y++) {
    for (let x = 0; x < SISI; x++) {
      const [r, g, b, a = 255] = isi(x, y);
      data.set([r, g, b, a], (y * SISI + x) * 4);
    }
  }
  return data;
}
const nama = (rgba) => warnaDominan(rgba, kamus).map((w) => w.nama);

test('PF-08: warna polos → satu warna', () => {
  assert.deepEqual(nama(gambar(() => [40, 80, 220])), ['biru']);
  assert.deepEqual(nama(gambar(() => [224, 48, 48])), ['merah']);
  assert.equal(kalimatWarna(warnaDominan(gambar(() => [40, 80, 220]), kamus)), 'Warna dominan: biru.');
});

test('PF-08: dua warna (biru 60% + putih 40%) → "biru dan putih", porsi terbesar dulu', () => {
  const rgba = gambar((x) => (x < SISI * 0.6 ? [32, 80, 224] : [250, 250, 250]));
  const hasil = warnaDominan(rgba, kamus);
  assert.deepEqual(hasil.map((w) => w.nama), ['biru', 'putih']);
  assert.ok(Math.abs(hasil[0].porsi - 0.6) < 0.03);
  assert.equal(kalimatWarna(hasil), 'Warna dominan: biru dan putih.');
});

test('PF-08: hitam-putih (papan catur) → hitam dan putih', () => {
  const rgba = gambar((x, y) => ((Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? [10, 10, 10] : [245, 245, 245]));
  assert.deepEqual(nama(rgba).sort(), ['hitam', 'putih']);
});

test('PF-08: warna dengan porsi < 15% tidak disebut; paling banyak 2 warna', () => {
  // 50% hijau, 40% kuning, 10% merah
  const rgba = gambar((x) => (x < 32 ? [40, 160, 60] : x < 58 ? [250, 220, 40] : [220, 30, 30]));
  assert.deepEqual(nama(rgba), ['hijau', 'kuning']);
  // empat warna masing-masing 25% → hanya dua yang disebut
  const empat = gambar((x) => [[40, 160, 60], [250, 220, 40], [220, 30, 30], [40, 80, 220]][Math.floor(x / 16)]);
  assert.equal(nama(empat).length, 2);
});

test('PF-08: gradasi satu warna digabung menjadi satu nama', () => {
  const rgba = gambar((x) => [20 + x, 60 + x, 180 + Math.floor(x / 2)]);
  assert.deepEqual(nama(rgba), ['biru']);
});

test('PF-08: piksel transparan diabaikan; gambar kosong → tanpa warna', () => {
  assert.deepEqual(kuantisasi(gambar(() => [0, 0, 0, 0])), []);
  assert.equal(kalimatWarna(warnaDominan(gambar(() => [0, 0, 0, 0]), kamus)), null);
  const separuh = gambar((x) => (x < 32 ? [245, 130, 30, 255] : [0, 0, 0, 0]));
  assert.deepEqual(nama(separuh), ['oranye']);
});

test('PF-08: kamus memuat 12 nama warna Indonesia dan pemetaan contoh dasar', () => {
  const daftar = Object.keys(kamus).filter((k) => !k.startsWith('_'));
  assert.deepEqual(daftar.sort(), ['abu-abu', 'biru', 'cokelat', 'hijau', 'hitam', 'krem', 'kuning', 'merah', 'merah muda', 'oranye', 'putih', 'ungu']);
  const kasus = {
    cokelat: [120, 75, 40], krem: [242, 230, 200], 'merah muda': [255, 160, 195], ungu: [130, 50, 160],
    'abu-abu': [128, 128, 128], kuning: [250, 220, 40], oranye: [245, 140, 30], hitam: [5, 5, 5],
  };
  for (const [harap, rgb] of Object.entries(kasus)) assert.equal(namaWarna(rgb, kamus), harap, String(rgb));
});

test('PF-08: kalimat menerima string atau objek', () => {
  assert.equal(kalimatWarna(['biru', 'putih']), 'Warna dominan: biru dan putih.');
  assert.equal(kalimatWarna([]), null);
  assert.equal(kalimatWarna(null), null);
});

test('PF-08: warna ikut disebut di kalimat kilat & cadangan (shared/deteksi.js)', async () => {
  const { kalimatKilat, kalimatSederhana } = await import('../../extension/shared/deteksi.js');
  const warna = [{ nama: 'biru', porsi: 0.6 }, { nama: 'putih', porsi: 0.4 }];
  assert.equal(kalimatKilat({ kalimat: '2 orang', warna }), 'Kemungkinan berisi: 2 orang. Warna dominan: biru dan putih.');
  assert.equal(kalimatKilat({ kalimat: '', warna: [{ nama: 'biru' }] }), 'Warna dominan: biru.');
  assert.equal(kalimatKilat({ kalimat: '', warna: [] }), null);
  assert.equal(
    kalimatSederhana({ kalimat: '', polos: true, warna: [{ nama: 'biru' }] }),
    'Deskripsi sederhana (tanpa AI): gambar hampir polos, tidak ada benda yang dikenali. Warna dominan: biru.',
  );
});
