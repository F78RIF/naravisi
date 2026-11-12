// NaraVisi · e2e/unit/deteksi.test.mjs
// Fungsi   : Tes unit PF-05 (Deteksi objek lokal): penggabungan label, ambang skor, terjemahan, penyaring gambar polos,
//            kalimat kilat & cadangan. Logika murni di extension/shared/deteksi.js, jadi cukup Node tanpa browser.
// Kebutuhan: PF-05
// Pemakaian: cd e2e && npm run test:unit

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  AMBANG_POLOS, gabungkanObjek, kalimatKilat, kalimatObjek, kalimatSederhana, layakDilewati, MAKS_JENIS, SKOR_MIN,
  terjemahkanLabel, variansiWarna,
} from '../../extension/shared/deteksi.js';

const kamus = JSON.parse(readFileSync(new URL('../../extension/shared/label-id.json', import.meta.url), 'utf8'));

// Label map di dalam efficientdet_lite0_int8.tflite (labels.txt), tanpa entri "???".
const LABEL_MODEL = [
  'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat', 'traffic light', 'fire hydrant',
  'stop sign', 'parking meter', 'bench', 'bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra',
  'giraffe', 'backpack', 'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee', 'skis', 'snowboard', 'sports ball', 'kite',
  'baseball bat', 'baseball glove', 'skateboard', 'surfboard', 'tennis racket', 'bottle', 'wine glass', 'cup', 'fork',
  'knife', 'spoon', 'bowl', 'banana', 'apple', 'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut',
  'cake', 'chair', 'couch', 'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse', 'remote',
  'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink', 'refrigerator', 'book', 'clock', 'vase', 'scissors',
  'teddy bear', 'hair drier', 'toothbrush',
];

const d = (label, score) => ({ label, score });

// [PF-05] Deteksi objek lokal — terjemahan: 80 label COCO model punya padanan bahasa Indonesia
test('PF-05 terjemahan: semua 80 label model diterjemahkan, huruf kecil, tidak kosong', () => {
  assert.equal(LABEL_MODEL.length, 80);
  assert.deepEqual(Object.keys(kamus).sort(), [...LABEL_MODEL].sort());
  for (const label of LABEL_MODEL) {
    const id = terjemahkanLabel(label, kamus);
    assert.ok(id && id === id.toLowerCase() && id.trim() === id, `${label} → ${id}`);
  }
  assert.equal(terjemahkanLabel('person', kamus), 'orang');
  assert.equal(terjemahkanLabel('  Bicycle ', kamus), 'sepeda'); // spasi & huruf besar dinormalkan
});

test('PF-05 terjemahan: label tak dikenal ("???", kosong, prototype) tidak pernah disebut', () => {
  for (const label of ['???', '', null, undefined, 'unicorn', 'toString', '__proto__', 'constructor']) {
    assert.equal(terjemahkanLabel(label, kamus), null, String(label));
  }
});

test('PF-05 ambang skor: < 0,5 dibuang, tepat 0,5 diambil, skor tidak valid dibuang', () => {
  assert.equal(SKOR_MIN, 0.5);
  const hasil = gabungkanObjek([d('person', 0.49), d('dog', 0.5), d('cat', Number.NaN), d('car', '0.9x'), d('bus', undefined)], kamus);
  assert.deepEqual(hasil.map((o) => o.nama), ['anjing']);
  assert.deepEqual(gabungkanObjek([d('person', 0.2)], kamus, { skorMin: 0.1 }).map((o) => o.nama), ['orang']);
});

test('PF-05 penggabungan: jumlah per jenis, skor tertinggi disimpan, urut jumlah lalu skor', () => {
  const hasil = gabungkanObjek(
    [d('bicycle', 0.7), d('person', 0.9), d('person', 0.6), d('car', 0.95), d('???', 0.99), d('person', 0.3)],
    kamus,
  );
  assert.deepEqual(hasil, [
    { nama: 'orang', jumlah: 2, skor: 0.9 },
    { nama: 'mobil', jumlah: 1, skor: 0.95 },
    { nama: 'sepeda', jumlah: 1, skor: 0.7 },
  ]);
  assert.equal(kalimatObjek(hasil), '2 orang, 1 mobil, 1 sepeda');
});

test('PF-05 penggabungan: maksimal 5 jenis (yang terbanyak/terkuat)', () => {
  assert.equal(MAKS_JENIS, 5);
  const banyak = ['person', 'person', 'person', 'car', 'car', 'dog', 'cat', 'bird', 'cup', 'book'].map((l, i) => d(l, 0.9 - i * 0.01));
  const hasil = gabungkanObjek(banyak, kamus);
  assert.equal(hasil.length, 5);
  assert.equal(kalimatObjek(hasil), '3 orang, 2 mobil, 1 anjing, 1 kucing, 1 burung');
});

test('PF-05 penggabungan: masukan kosong/rusak → daftar & kalimat kosong', () => {
  for (const input of [[], null, undefined, [null, {}, d('person', null)]]) {
    assert.deepEqual(gabungkanObjek(input, kamus), []);
  }
  assert.equal(kalimatObjek([]), '');
});

test('PF-05 identitas: orang hanya disebut jumlahnya', () => {
  const kalimat = kalimatObjek(gabungkanObjek([d('person', 0.9), d('person', 0.8), d('person', 0.7)], kamus));
  assert.equal(kalimat, '3 orang');
});

// [PF-05] Deteksi objek lokal — penyaring: variansi warna & keputusan melewati gambar
test('PF-05 penyaring: variansi warna gambar polos 0, dua warna kontras tinggi, piksel transparan diabaikan', () => {
  const piksel = (...rgba) => Uint8ClampedArray.from(rgba.flat());
  assert.equal(variansiWarna(piksel(...Array(16).fill([30, 60, 200, 255]))), 0);
  assert.equal(variansiWarna(piksel([0, 0, 0, 255], [255, 255, 255, 255])), 127.5);
  assert.equal(variansiWarna(piksel([10, 10, 10, 255], [255, 255, 255, 0])), 0); // putih transparan tidak dihitung
  assert.equal(variansiWarna(piksel()), 0);
  // Derau kecil (±6) tetap "hampir polos"; pita putih seperempat gambar tidak.
  const derau = Array.from({ length: 64 }, (_, i) => [100 + (i % 2 ? 6 : -6), 100, 100, 255]);
  assert.ok(variansiWarna(piksel(...derau)) < AMBANG_POLOS);
  const pita = Array.from({ length: 64 }, (_, i) => (i % 4 === 0 ? [255, 255, 255, 255] : [32, 80, 224, 255]));
  assert.ok(variansiWarna(piksel(...pita)) >= AMBANG_POLOS);
});

test('PF-05 penyaring: dilewati hanya bila TIDAK ada objek DAN hampir polos', () => {
  assert.equal(layakDilewati({ objek: [], polos: true }), true);
  assert.equal(layakDilewati({ objek: [], polos: false }), false);
  assert.equal(layakDilewati({ objek: [{ nama: 'orang', jumlah: 1 }], polos: true }), false);
  assert.equal(layakDilewati(null), false); // detektor gagal → tetap dikirim ke AI
  assert.equal(layakDilewati({ polos: true }), false);
});

test('PF-05 kalimat kilat & cadangan', () => {
  assert.equal(kalimatKilat({ kalimat: '2 orang, 1 sepeda' }), 'Kemungkinan berisi: 2 orang, 1 sepeda.');
  assert.equal(kalimatKilat({ kalimat: '' }), null);
  assert.equal(kalimatKilat(null), null);
  assert.equal(kalimatSederhana({ kalimat: '1 kucing', polos: false }), 'Deskripsi sederhana (tanpa AI): kemungkinan berisi 1 kucing.');
  assert.equal(kalimatSederhana({ kalimat: '', polos: true }), 'Deskripsi sederhana (tanpa AI): gambar hampir polos, tidak ada benda yang dikenali.');
  assert.equal(kalimatSederhana({ kalimat: '', polos: false }), 'Deskripsi sederhana (tanpa AI): tidak ada benda yang dikenali.');
  assert.equal(kalimatSederhana(null), null);
});
