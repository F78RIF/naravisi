// NaraVisi · e2e/unit/lapis-lokal.test.mjs
// Fungsi   : Tes unit penggabung lapis lokal (PF-05..PF-08): urutan bacaan benda → warna → tulisan → kode QR,
//            sakelar pengaturan, tambahan setelah deskripsi AI (tulisan tidak diulang bila AI memuat teks_dalam_gambar,
//            info QR tetap), kalimat cadangan "Deskripsi sederhana (tanpa AI)", dan penyaring Baca berurutan.
// Kebutuhan: PF-05, PF-06, PF-07, PF-08
// Pemakaian: cd e2e && npm run test:unit

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  bagianLokal, kalimatBenda, kalimatSederhanaLengkap, layakDilewatiLengkap, perluSetelahAi,
} from '../../extension/shared/lapis-lokal.js';

const benda = { objek: [{ nama: 'orang', jumlah: 2, skor: 0.9 }], kalimat: '2 orang', polos: false, warna: [{ nama: 'biru', porsi: 0.7 }] };
const tulisan = { teks: 'Diskon akhir tahun', kalimat: 'Tulisan: "Diskon akhir tahun".' };
const kode = { kode: [{ jenis: 'tautan', domain: 'rri.co.id' }], kalimat: 'Ada kode QR menuju rri.co.id.' };

test('urutan bacaan: benda + warna, lalu tulisan, lalu kode QR', () => {
  const b = bagianLokal({ benda, tulisan, kode });
  assert.deepEqual(b.map((x) => x.bagian), ['benda', 'tulisan', 'kode']);
  assert.equal(
    b.map((x) => x.text).join(' '),
    'Kemungkinan berisi: 2 orang. Warna dominan: biru. Tulisan: "Diskon akhir tahun". Ada kode QR menuju rri.co.id.',
  );
});

test('pengaturan dimatikan → bagian itu tidak dibacakan', () => {
  assert.equal(kalimatBenda(benda, { sebutWarna: false }), 'Kemungkinan berisi: 2 orang.');
  assert.deepEqual(bagianLokal({ benda, tulisan, kode }, { bacaTulisan: false, bacaQr: false }).map((x) => x.bagian), ['benda']);
  assert.equal(kalimatBenda({ objek: [], kalimat: '', warna: [{ nama: 'biru' }] }, { sebutWarna: false }), null);
  assert.deepEqual(bagianLokal({ benda: null, tulisan: null, kode: null }), []);
});

test('setelah deskripsi AI: tulisan tidak diulang bila AI memuat teks_dalam_gambar; info QR tetap', () => {
  const t = { bagian: 'tulisan', text: tulisan.kalimat };
  const k = { bagian: 'kode', text: kode.kalimat };
  const bd = { bagian: 'benda', text: 'Kemungkinan berisi: 2 orang.' };
  assert.equal(perluSetelahAi(t, { adaTeksAi: true }), false);
  assert.equal(perluSetelahAi(t, { adaTeksAi: false }), true);
  assert.equal(perluSetelahAi(k, { adaTeksAi: true }), true);
  assert.equal(perluSetelahAi(bd, { adaTeksAi: false }), false);
  // sudah terdengar saat menunggu AI → tidak diulang
  assert.equal(perluSetelahAi(k, { sudah: new Set(['kode']) }), false);
  assert.equal(perluSetelahAi(t, { adaTeksAi: false, sudah: new Set(['tulisan']) }), false);
});

test('cadangan tanpa AI menggabungkan semua lapis, sesuai pengaturan', () => {
  assert.equal(
    kalimatSederhanaLengkap({ benda, tulisan, kode }),
    'Deskripsi sederhana (tanpa AI): kemungkinan berisi 2 orang. Warna dominan: biru. Tulisan: "Diskon akhir tahun". Ada kode QR menuju rri.co.id.',
  );
  assert.equal(
    kalimatSederhanaLengkap({ benda, tulisan, kode }, { sebutWarna: false, bacaTulisan: false, bacaQr: false }),
    'Deskripsi sederhana (tanpa AI): kemungkinan berisi 2 orang.',
  );
  assert.equal(
    kalimatSederhanaLengkap({ benda: null, tulisan, kode: null }),
    'Deskripsi sederhana (tanpa AI): Tulisan: "Diskon akhir tahun".',
  );
  assert.equal(
    kalimatSederhanaLengkap({ benda: { objek: [], kalimat: '', polos: true, warna: [] } }),
    'Deskripsi sederhana (tanpa AI): gambar hampir polos, tidak ada benda yang dikenali.',
  );
  assert.equal(kalimatSederhanaLengkap({ benda: null, tulisan: null, kode: null }), null);
});

test('Baca berurutan: dilewati hanya bila tanpa benda, hampir polos, tanpa tulisan & tanpa QR', () => {
  const polos = { objek: [], kalimat: '', polos: true, warna: [] };
  assert.equal(layakDilewatiLengkap({ benda: polos }), true);
  assert.equal(layakDilewatiLengkap({ benda: polos, tulisan, kode: null }), false);
  assert.equal(layakDilewatiLengkap({ benda: polos, tulisan: null, kode }), false);
  assert.equal(layakDilewatiLengkap({ benda: { ...polos, polos: false } }), false);
  assert.equal(layakDilewatiLengkap({ benda }), false);
  assert.equal(layakDilewatiLengkap({ benda: null }), false); // detektor gagal → tetap dikirim ke AI
});

test('PF-09: orientasi dari rasio lebar-tinggi; bawaan tidak disebut, dinyalakan → di akhir bagian benda', async () => {
  const { orientasi, kalimatOrientasi } = await import('../../extension/shared/orientasi.js');
  assert.equal(orientasi(1200, 800), 'mendatar');
  assert.equal(orientasi(800, 1200), 'tegak');
  assert.equal(orientasi(500, 480), 'persegi');
  assert.equal(orientasi(0, 100), null);
  assert.equal(kalimatOrientasi('tegak'), 'Gambar tegak.');
  assert.equal(kalimatOrientasi('miring'), null);
  const b = { ...benda, orientasi: 'mendatar' };
  assert.equal(kalimatBenda(b), 'Kemungkinan berisi: 2 orang. Warna dominan: biru.');
  assert.equal(kalimatBenda(b, { sebutOrientasi: true }), 'Kemungkinan berisi: 2 orang. Warna dominan: biru. Gambar mendatar.');
  assert.equal(kalimatSederhanaLengkap({ benda: b }, { sebutOrientasi: true }),
    'Deskripsi sederhana (tanpa AI): kemungkinan berisi 2 orang. Warna dominan: biru. Gambar mendatar.');
});
