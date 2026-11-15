// NaraVisi · e2e/unit/qr.test.mjs
// Fungsi   : Tes unit PF-07 (Kode QR & barcode): QR berisi URL (hanya domain dibacakan), QR teks (maks. 100 karakter),
//            QR berbahaya (javascript:, data:, file:, intent:, disamarkan), tanpa QR, barcode, duplikat.
//            Logika murni di extension/shared/qr.js, jadi cukup Node tanpa browser.
// Kebutuhan: PF-07
// Pemakaian: cd e2e && npm run test:unit

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { golongkanKode, kalimatKode, MAKS_TEKS_QR, ringkasKode, tautanAman } from '../../extension/shared/qr.js';

const qr = (rawValue) => ({ rawValue, format: 'qr_code' });
const kalimat = (raw) => kalimatKode(golongkanKode(qr(raw)));

test('PF-07: QR berisi URL → hanya nama domain yang dibacakan', () => {
  assert.equal(kalimat('https://rri.co.id/berita/123?utm=abc'), 'Ada kode QR menuju rri.co.id.');
  assert.equal(kalimat('http://www.example.com'), 'Ada kode QR menuju example.com.');
  const k = golongkanKode(qr('https://example.com/a?b=1'));
  assert.equal(k.jenis, 'tautan');
  assert.equal(k.url, 'https://example.com/a?b=1');
  // Penyamaran "nama@host": yang disebut host aslinya.
  assert.equal(kalimat('https://bank.co.id@jahat.example/login'), 'Ada kode QR menuju jahat.example.');
});

test('PF-07: QR berisi teks → dibacakan maks. 100 karakter', () => {
  assert.equal(kalimat('Selamat datang di perpustakaan'), 'Ada kode QR berisi teks: Selamat datang di perpustakaan.');
  const panjang = 'kata '.repeat(60);
  const k = golongkanKode(qr(panjang));
  assert.equal(k.jenis, 'teks');
  assert.ok(k.terpotong);
  assert.ok(k.teks.length <= MAKS_TEKS_QR + 1);
  assert.match(kalimatKode(k), /…$/);
  // Domain tanpa skema bukan tautan: dibacakan sebagai teks, tidak bisa dibuka.
  assert.equal(golongkanKode(qr('www.rri.co.id')).jenis, 'teks');
  assert.equal(golongkanKode(qr('mailto:info@example.com')).jenis, 'teks');
});

test('PF-07: QR berbahaya → "kode QR berisi teks", isinya tidak dibacakan', () => {
  const berbahaya = [
    'javascript:alert(1)', 'JaVaScRiPt:alert(document.cookie)', ' java\tscript:alert(1)', '\u200Bjavascript:alert(1)',
    'data:text/html,<script>alert(1)</script>', 'file:///C:/Windows/win.ini', 'intent://scan/#Intent;scheme=zxing;end',
    'vbscript:msgbox(1)', 'chrome://settings', 'blob:https://example.com/123', 'http://', 'https://[rusak',
  ];
  for (const raw of berbahaya) {
    const k = golongkanKode(qr(raw));
    assert.equal(k.jenis, 'berbahaya', raw);
    assert.equal(kalimatKode(k), 'Ada kode QR berisi teks.', raw);
    assert.equal(k.url, undefined, raw);
  }
});

test('PF-07: tanpa QR / isi kosong → tidak ada kalimat', () => {
  assert.deepEqual(ringkasKode([]), { kode: [], kalimat: '' });
  assert.deepEqual(ringkasKode(null), { kode: [], kalimat: '' });
  assert.equal(golongkanKode(qr('   ')), null);
  assert.equal(kalimatKode(null), null);
});

test('PF-07: barcode, duplikat, dan batas 2 kode', () => {
  assert.equal(kalimatKode(golongkanKode({ rawValue: '8991234567890', format: 'ean_13' })), 'Ada kode batang berisi teks: 8991234567890.');
  const r = ringkasKode([qr('https://example.com'), qr('https://example.com'), qr('halo'), qr('lagi')]);
  assert.equal(r.kode.length, 2);
  assert.equal(r.kalimat, 'Ada kode QR menuju example.com. Ada kode QR berisi teks: halo.');
});

test('PF-07: tautanAman hanya meloloskan http/https (pemeriksaan ulang sebelum membuka tab)', () => {
  assert.equal(tautanAman('https://example.com'), 'https://example.com/');
  for (const u of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'intent://x', '', null, 'example.com']) {
    assert.equal(tautanAman(u), null, String(u));
  }
});
