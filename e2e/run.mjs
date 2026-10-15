// Uji end-to-end NaraVisi (Fase 6) di Chromium dengan Playwright.
//
// Yang berjalan sungguhan: extension (MV3), backend NaraVisi (semua service + rute,
// basis data SQLite di memori), dashboard Admin. Yang dipalsukan: model AI
// (mengembalikan teks tetap) — supaya uji cepat dan tidak butuh GPU/unduhan model.
//
// Jalankan: cd e2e && npm install && npm test

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const sharp = require('sharp');

const here = path.dirname(fileURLToPath(import.meta.url));
const extensionDir = path.resolve(here, '../extension');
const shotsDir = path.resolve(here, 'screenshots');
mkdirSync(shotsDir, { recursive: true });

const { startTestApp, ADMIN } = await import('../backend/test/support/testApp.js');

// ---------------------------------------------------------------------------
// Backend NaraVisi (rute & service asli) + situs uji berisi gambar
// ---------------------------------------------------------------------------
const backend = await startTestApp();
backend.clock.set(new Date().toISOString()); // jam nyata agar token & tanggal wajar
backend.ai.caption = async ({ lang, imageBase64 }) => {
  backend.ai.calls += 1;
  const mime = Buffer.from(imageBase64, 'base64')[0] === 0xff ? 'JPEG' : 'PNG';
  return { text: `Deskripsi uji untuk gambar ${mime}.`, textEn: null, lang, model: 'fake', latencyMs: 1 };
};
const API = `${backend.base}/api/v1`;
backend.services.config.publicUrl = backend.base; // halaman bayar simulasi di server uji

const solid = (w, h, rgb) => sharp({ create: { width: w, height: h, channels: 3, background: rgb } });
const fixtures = {
  '/img/wide.png': { type: 'image/png', body: await solid(400, 250, '#2050e0').png().toBuffer() },
  '/img/photo.jpg': { type: 'image/jpeg', body: await solid(300, 300, '#e03030').jpeg().toBuffer() },
  '/img/modern.avif': { type: 'image/avif', body: await solid(320, 200, '#30a050').avif().toBuffer() },
  '/img/tiny.png': { type: 'image/png', body: await solid(16, 16, '#000').png().toBuffer() },
  '/img/hidden.png': { type: 'image/png', body: await solid(200, 200, '#999').png().toBuffer() },
  '/img/logo.svg': {
    type: 'image/svg+xml',
    body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><circle cx="100" cy="100" r="90" fill="orange"/></svg>'),
  },
};
const inlinePng = `data:image/png;base64,${(await solid(120, 120, '#f0c020').png().toBuffer()).toString('base64')}`;
const testPage = `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Berita Uji</title></head>
<body style="font-family:sans-serif;padding:20px">
  <h1>Berita Uji</h1><a href="#" id="page-link">Tautan halaman</a>
  <p><img src="/img/wide.png" alt="" width="400" height="250"></p>
  <p><img src="/img/photo.jpg" alt="Foto produk sepatu" width="300" height="300"></p>
  <p><img src="/img/tiny.png" alt="ikon" width="16" height="16"> ikon kecil</p>
  <p><img src="/img/hidden.png" style="display:none" alt="tersembunyi"></p>
  <p><img src="/img/modern.avif" width="320" height="200"></p>
  <p><img src="/img/logo.svg" alt="Logo" width="200" height="200"></p>
  <p><img src="${inlinePng}" width="120" height="120" alt="Gambar inline"></p>
  <p><img src="/img/photo.jpg" alt="duplikat" width="150" height="150"></p>
</body></html>`;
const site = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/berita.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(testPage);
  }
  if (req.url === '/kosong.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end('<!doctype html><title>Kosong</title><h1>Tanpa gambar</h1>');
  }
  const f = fixtures[req.url];
  res.writeHead(f ? 200 : 404, { 'content-type': f?.type ?? 'text/plain' });
  res.end(f?.body ?? 'not found');
});
await new Promise((r) => site.listen(0, '127.0.0.1', r));
const SITE = `http://127.0.0.1:${site.address().port}`;

// ---------------------------------------------------------------------------
// Chromium + extension
// ---------------------------------------------------------------------------
const context = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'nv-')), {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1100, height: 820 },
  args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
});
context.on('page', (p) => p.on('dialog', (d) => d.accept()));

const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✔ ${name}`);
  } catch (err) {
    results.push({ name, ok: false, err });
    console.log(`  ✘ ${name}\n    ${String(err.message).split('\n').slice(0, 6).join('\n    ')}`);
  }
}
const section = (t) => console.log(`\n${t}`);

/** Audit aksesibilitas ringan: kontrol berlabel, tombol bernama, gambar ber-alt, satu h1. */
async function a11yAudit(page, root = 'document') {
  return page.evaluate((rootSel) => {
    const scope = rootSel === 'document' ? document : document.querySelector(rootSel).shadowRoot;
    const problems = [];
    const name = (e) =>
      (e.getAttribute('aria-label') || e.getAttribute('aria-labelledby') || e.textContent || e.title || '').trim();
    for (const e of scope.querySelectorAll('input:not([type=hidden]), select, textarea')) {
      const labelled = e.id && scope.querySelector(`label[for="${e.id}"]`);
      if (!labelled && !e.getAttribute('aria-label') && !e.getAttribute('aria-labelledby')) problems.push(`kontrol tanpa label: ${e.outerHTML.slice(0, 80)}`);
    }
    for (const b of scope.querySelectorAll('button, [role=button], a[href]')) {
      if (b.hidden || b.closest('[hidden]')) continue;
      if (!name(b)) problems.push(`tombol/tautan tanpa nama: ${b.outerHTML.slice(0, 80)}`);
    }
    for (const i of scope.querySelectorAll('img')) {
      if (!i.hasAttribute('alt')) problems.push(`gambar tanpa alt: ${i.outerHTML.slice(0, 80)}`);
    }
    if (rootSel === 'document' && document.querySelectorAll('h1').length !== 1) problems.push('jumlah h1 bukan 1');
    if (rootSel === 'document' && !document.documentElement.lang) problems.push('atribut lang kosong');
    return problems;
  }, root);
}

let sw;
const extPage = (p) => `chrome-extension://${new URL(sw.url()).host}/${p}`;
const toggleOn = (url) =>
  sw.evaluate(async (u) => {
    const [tab] = await chrome.tabs.query({ url: u });
    return globalThis.naraVisi.togglePanel(tab.id);
  }, url);

try {
  [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  for (let i = 0; i < 50 && !(await sw.evaluate(() => Boolean(globalThis.chrome?.storage && globalThis.naraVisi))); i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  await sw.evaluate((apiBase) => chrome.storage.sync.set({ apiBase }), API);

  const pageErrors = [];
  const watch = (p) => p.on('pageerror', (e) => pageErrors.push(`${p.url()}: ${e}`));
  const spoken = () => sw.evaluate(() => globalThis.naraVisi.spokenLog.map((s) => s.text));
  const announcements = async () => (await spoken()).filter((t) => /^Ada \d+ gambar\./.test(t));

  // =========================================================================
  section('Pemandu suara saat pertama dipasang');
  await step('tab sambutan terbuka, fokus di judul, sambutan dibacakan; Tab → kolom Email', async () => {
    const welcome =
      context.pages().find((p) => p.url().includes('selamat-datang.html')) ??
      (await context.waitForEvent('page', { predicate: (p) => p.url().includes('selamat-datang.html'), timeout: 10000 }));
    watch(welcome);
    await welcome.waitForFunction(() => document.activeElement?.id === 'title');
    assert.match((await spoken())[0], /^Selamat datang di NaraVisi\. Tekan Tab untuk masuk atau mendaftar\. Setelah masuk, /);
    assert.deepEqual(await a11yAudit(welcome), []);
    assert.equal(await welcome.locator('#register-form').isVisible(), false);
    await welcome.keyboard.press('Tab');
    assert.equal(await welcome.evaluate(() => document.activeElement.id), 'login-email');
    await welcome.close();
  });

  // =========================================================================
  section('Akun lewat popup (UC-AKUN-01, UC-AKUN-05)');
  const popup = await context.newPage();
  watch(popup);
  await popup.setViewportSize({ width: 330, height: 560 });
  await popup.goto(extPage('popup/popup.html'));

  await step('popup belum masuk menampilkan formulir login dengan fokus di email', async () => {
    await popup.locator('#guest:not([hidden])').waitFor();
    assert.equal(await popup.evaluate(() => document.activeElement.id), 'login-email');
  });

  await step('popup belum masuk: form Daftar benar-benar tidak terlihat (isVisible)', async () => {
    assert.equal(await popup.locator('#login-form').isVisible(), true);
    assert.equal(await popup.locator('#register-form').isVisible(), false);
    assert.equal(await popup.getByLabel('Nama').isVisible(), false);
  });

  await step('klik "Daftar" → hanya form Daftar terlihat, fokus di Nama', async () => {
    await popup.getByRole('button', { name: 'Belum punya akun? Daftar' }).click();
    assert.equal(await popup.locator('#register-form').isVisible(), true);
    assert.equal(await popup.locator('#login-form').isVisible(), false);
    assert.equal(await popup.evaluate(() => document.activeElement.id), 'reg-name');
  });

  await step('Daftar dengan kolom kosong → error per kolom, aria-invalid, fokus ke Nama', async () => {
    await popup.getByRole('button', { name: 'Daftar', exact: true }).click();
    assert.equal(await popup.evaluate(() => document.activeElement.id), 'reg-name');
    assert.equal(await popup.locator('#reg-name').getAttribute('aria-invalid'), 'true');
    assert.equal(await popup.locator('#reg-name').getAttribute('aria-describedby'), 'reg-name-error');
    assert.equal(await popup.locator('#reg-name-error').innerText(), 'Nama wajib diisi.');
    assert.equal(await popup.locator('#reg-password-error').isVisible(), true);
    assert.equal(await popup.locator('#message').innerText(), 'Nama wajib diisi.');
  });

  await step('tombol "Tampilkan kata sandi" (aria-pressed) menampilkan & menyembunyikan sandi', async () => {
    const btn = popup.locator('#register-form').getByRole('button', { name: 'Tampilkan kata sandi' });
    await btn.click();
    assert.equal(await btn.getAttribute('aria-pressed'), 'true');
    assert.equal(await popup.locator('#reg-password').getAttribute('type'), 'text');
    await btn.click();
    assert.equal(await btn.getAttribute('aria-pressed'), 'false');
    assert.equal(await popup.locator('#reg-password').getAttribute('type'), 'password');
  });

  await step('registrasi dari popup → langsung masuk sebagai Gratis, kuota 10', async () => {
    await popup.getByLabel('Nama').fill('Rifat Uji');
    await popup.getByLabel('Email').last().fill('rifat@uji.id');
    await popup.getByLabel('Kata sandi (minimal 8 karakter)').fill('sandiku123');
    await popup.getByRole('button', { name: 'Daftar', exact: true }).click();
    await popup.locator('#member:not([hidden])').waitFor();
    assert.match(await popup.locator('#plan').innerText(), /Gratis · sisa kuota hari ini 10 dari 10/);
    assert.match((await spoken()).at(-1), /^Berhasil masuk sebagai Rifat Uji\. Jatah gratis hari ini 10 gambar\. (Tekan .+|Klik ikon NaraVisi di toolbar) untuk memindai gambar\.$/);
  });

  await step('login dengan sandi salah → pesan jelas', async () => {
    await popup.getByRole('button', { name: 'Keluar' }).click();
    await popup.getByLabel('Email').first().fill('rifat@uji.id');
    await popup.getByLabel('Kata sandi', { exact: true }).fill('salah12345');
    await popup.getByRole('button', { name: 'Masuk', exact: true }).click();
    await popup.locator('#message', { hasText: 'Email atau kata sandi salah.' }).waitFor();
  });

  await step('login benar', async () => {
    await popup.getByLabel('Kata sandi', { exact: true }).fill('sandiku123');
    await popup.getByRole('button', { name: 'Masuk', exact: true }).click();
    await popup.locator('#hello', { hasText: 'Halo, Rifat Uji.' }).waitFor();
  });

  await step('popup lolos audit aksesibilitas', async () => assert.deepEqual(await a11yAudit(popup), []));
  await popup.screenshot({ path: path.join(shotsDir, '01-popup.png') });
  await popup.close();

  // =========================================================================
  section('Pengumuman jumlah gambar saat halaman dibuka');
  const ann = await context.newPage();
  watch(ann);

  await step('halaman dengan gambar → "Ada 5 gambar" diumumkan sekali saja', async () => {
    const before = (await announcements()).length;
    await ann.goto(`${SITE}/berita.html`);
    await ann.bringToFront();
    for (let i = 0; i < 50 && (await announcements()).length === before; i++) await new Promise((r) => setTimeout(r, 100));
    const list = await announcements();
    assert.equal(list.length, before + 1);
    assert.match(list.at(-1), /^Ada 5 gambar\. (Tekan .+|Klik ikon NaraVisi di toolbar) untuk mendengar deskripsinya\.$/);
    await ann.evaluate(() => { location.hash = 'bagian-2'; }); // dokumen sama → tidak diumumkan lagi
    await new Promise((r) => setTimeout(r, 2500));
    assert.equal((await announcements()).length, before + 1);
    assert.equal(await ann.locator('[data-naravisi-mark]').count(), 0); // hanya menghitung, tidak menandai
    assert.equal(backend.ai.calls, 0); // tidak ada deskripsi otomatis
  });

  await step('sakelar pengumuman dimatikan di Pengaturan → tidak ada pengumuman', async () => {
    const opt = await context.newPage();
    await opt.goto(extPage('pages/pengaturan.html'));
    const toggle = opt.getByLabel('Umumkan jumlah gambar saat halaman dibuka');
    assert.equal(await toggle.isChecked(), true); // bawaan aktif
    await toggle.uncheck();
    await opt.locator('#msg', { hasText: 'Pengumuman jumlah gambar dimatikan.' }).waitFor();
    await opt.close();
    const before = (await announcements()).length;
    await ann.reload();
    await ann.bringToFront();
    await new Promise((r) => setTimeout(r, 3000));
    assert.equal((await announcements()).length, before);
  });
  await ann.close();

  // =========================================================================
  section('Panel deskripsi gambar (UC-GBR-01..07, UC-LAP-01)');
  const page = await context.newPage();
  watch(page);
  await page.goto(`${SITE}/berita.html`);
  await page.focus('#page-link');
  const host = page.locator('#naravisi-host');
  const status = page.locator('#nv-status');
  const text = page.locator('#nv-text');
  const attached = (sel, timeout = 10000) => page.locator(sel).waitFor({ state: 'attached', timeout });

  await step('UC-GBR-01/02: 5 gambar ditemukan & ditandai (ikon, tersembunyi, duplikat diabaikan)', async () => {
    const res = await toggleOn(`${SITE}/berita.html`);
    assert.equal(res.count, 5);
    await status.filter({ hasText: '5 gambar ditemukan' }).waitFor();
    assert.equal(await page.locator('[data-naravisi-mark]').count(), 5);
    assert.match(await page.locator('#nv-list [role="option"]').nth(1).innerText(), /Foto produk sepatu/);
  });

  await step('panel lolos audit aksesibilitas', async () => {
    const problems = await a11yAudit(page, '#naravisi-host');
    assert.deepEqual(problems, [], problems.join('\n'));
  });

  await step('UC-GBR-04..07: Enter → deskripsi tampil, dibacakan, sisa kuota diumumkan', async () => {
    await page.keyboard.press('Enter');
    await text.filter({ hasText: 'gambar PNG' }).waitFor({ timeout: 10000 });
    await status.filter({ hasText: 'Sisa kuota hari ini: 9.' }).waitFor();
    assert.equal(await host.getAttribute('data-last-spoken'), 'Deskripsi uji untuk gambar PNG.');
  });

  await step('UC-LAP-01 alt: laporan tanpa alasan ditolak', async () => {
    await page.keyboard.press('l');
    await page.locator('#nv-reason').waitFor();
    await page.getByRole('button', { name: 'Kirim laporan' }).click();
    await status.filter({ hasText: 'Alasan pelaporan wajib diisi' }).waitFor();
  });

  await step('UC-LAP-01: kirim laporan dari panel', async () => {
    await page.locator('#nv-reason').fill('Warnanya biru, bukan kucing.');
    await page.getByRole('button', { name: 'Kirim laporan' }).click();
    await status.filter({ hasText: 'Laporan Anda sudah dikirim' }).waitFor();
    const n = await backend.db.get('SELECT COUNT(*) AS n FROM laporan_deskripsi');
    assert.equal(Number(n.n), 1);
  });

  await step('AVIF dikonversi ke JPEG oleh extension', async () => {
    await page.locator('#nv-list').focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await text.filter({ hasText: 'gambar JPEG' }).waitFor({ timeout: 10000 });
  });

  await step('SVG ditolak dengan pesan jelas', async () => {
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await status.filter({ hasText: 'SVG' }).waitFor({ timeout: 10000 });
  });

  await step('gambar data: URL dideskripsikan; tersimpan di riwayat tanpa URL gambar', async () => {
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await status.filter({ hasText: 'Sisa kuota hari ini: 7.' }).waitFor({ timeout: 10000 });
    const last = await backend.db.get('SELECT url_gambar, url_halaman FROM riwayat_deskripsi ORDER BY riwayat_id DESC LIMIT 1');
    assert.equal(last.url_gambar, null);
    assert.equal(last.url_halaman, `${SITE}/berita.html`);
  });

  await step('Esc menutup panel & mengembalikan fokus', async () => {
    await page.keyboard.press('Escape');
    assert.equal(await host.count(), 0);
    assert.equal(await page.locator('[data-naravisi-mark]').count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'page-link');
  });

  // =========================================================================
  section('Riwayat (UC-RWY-01..04)');
  const hist = await context.newPage();
  watch(hist);
  await hist.goto(extPage('pages/riwayat.html'));

  await step('UC-RWY-02: 3 riwayat tampil + info batas 7 hari untuk Gratis', async () => {
    await hist.locator('.item').first().waitFor();
    assert.equal(await hist.locator('.item').count(), 3);
    assert.match(await hist.locator('.notice').innerText(), /7 hari terakhir/);
  });

  await step('UC-RWY-03: putar ulang deskripsi', async () => {
    await hist.getByRole('button', { name: 'Putar ulang' }).first().click();
    assert.match(await hist.locator('body').getAttribute('data-last-spoken'), /Deskripsi uji/);
  });

  await step('UC-RWY-04: hapus riwayat (dengan konfirmasi)', async () => {
    await hist.getByRole('button', { name: 'Hapus' }).first().click();
    await hist.locator('#msg', { hasText: 'Riwayat berhasil dihapus.' }).waitFor();
    assert.equal(await hist.locator('.item').count(), 2);
  });

  await step('halaman riwayat lolos audit aksesibilitas', async () => assert.deepEqual(await a11yAudit(hist), []));
  await hist.screenshot({ path: path.join(shotsDir, '03-riwayat.png'), fullPage: true });
  await hist.close();

  // =========================================================================
  section('Pengaturan (UC-AKS-01..03)');
  const set = await context.newPage();
  watch(set);
  await set.goto(extPage('pages/pengaturan.html'));

  await step('UC-AKS-01: pengaturan tampil; nada & jenis suara terkunci untuk Gratis', async () => {
    await set.getByLabel('Bahasa deskripsi').waitFor();
    assert.equal(await set.locator('#nada').isDisabled(), true);
    assert.equal(await set.locator('#suara').isDisabled(), true);
    assert.match(await set.locator('.notice').innerText(), /khusus Pengguna Premium/);
  });

  await step('UC-AKS-02 alt: pintasan bentrok Ctrl+T ditolak', async () => {
    await set.getByLabel('Pintasan keyboard untuk memindai').fill('Ctrl+T');
    await set.getByRole('button', { name: 'Simpan pengaturan' }).click();
    await set.locator('#msg', { hasText: 'bentrok' }).waitFor();
  });

  await step('UC-AKS-02/03: simpan pintasan & kecepatan suara 1.5', async () => {
    await set.getByLabel('Pintasan keyboard untuk memindai').fill('Alt+Shift+Y');
    await set.locator('#kecepatan').fill('1.5');
    await set.getByRole('button', { name: 'Simpan pengaturan' }).click();
    await set.locator('#msg', { hasText: 'Pengaturan berhasil disimpan.' }).waitFor();
    const row = await backend.db.get('SELECT kecepatan_suara, pintasan_keyboard FROM pengaturan_aksesibilitas ps JOIN users u ON u.user_id = ps.user_id WHERE u.email = ?', ['rifat@uji.id']);
    assert.equal(Number(row.kecepatan_suara), 1.5);
    assert.equal(row.pintasan_keyboard, 'Alt+Shift+Y');
    const tts = await sw.evaluate(async () => (await chrome.storage.local.get('nvTts')).nvTts);
    assert.equal(tts.kecepatan_suara, 1.5);
  });

  await step('tombol "Coba suara" membacakan contoh', async () => {
    await set.getByRole('button', { name: 'Coba suara' }).click();
    assert.match(await set.locator('body').getAttribute('data-last-spoken'), /contoh suara NaraVisi/);
  });

  await step('halaman pengaturan lolos audit aksesibilitas', async () => assert.deepEqual(await a11yAudit(set), []));
  await set.screenshot({ path: path.join(shotsDir, '04-pengaturan.png'), fullPage: true });

  // =========================================================================
  section('Kuota habis (UC-GBR-04 alur alternatif)');
  await step('setelah 10 deskripsi, panel menolak & menawarkan Premium', async () => {
    const userId = (await backend.db.get('SELECT user_id FROM users WHERE email = ?', ['rifat@uji.id'])).user_id;
    const today = backend.services.subscriptions.today();
    await backend.db.run('UPDATE kuota_harian SET jumlah_permintaan = 10 WHERE user_id = ? AND tanggal = ?', [userId, today]);
    await page.reload();
    await toggleOn(`${SITE}/berita.html`);
    await page.locator('#nv-list').focus();
    await page.keyboard.press('ArrowDown'); // foto.jpg belum ada di cache
    await page.keyboard.press('Enter');
    await status.filter({ hasText: 'Kuota harian Anda (10 deskripsi) sudah habis' }).waitFor({ timeout: 10000 });
    assert.equal(await page.getByRole('button', { name: 'Lihat paket Premium' }).isVisible(), true);
  });

  // =========================================================================
  section('Premium (UC-PRM-01..04) — mode simulasi');
  const prem = await context.newPage();
  watch(prem);
  await prem.goto(extPage('pages/premium.html'));

  await step('UC-PRM-01: paket Bulanan Rp15.000 / 30 hari tampil', async () => {
    await prem.locator('.price').waitFor();
    assert.match(await prem.locator('.price').innerText(), /Rp15\.000/);
    assert.match(await prem.locator('.price').innerText(), /30 hari/);
  });

  await step('UC-PRM-02/03: beli → halaman bayar terbuka → bayar → akun Premium', async () => {
    const [payTab] = await Promise.all([context.waitForEvent('page'), prem.getByRole('button', { name: 'Beli Premium Bulanan' }).click()]);
    await payTab.waitForLoadState();
    assert.match(payTab.url(), /\/pay\/simulate\//);
    await payTab.getByRole('button', { name: 'Bayar (simulasi berhasil)' }).click();
    await payTab.getByRole('status').filter({ hasText: 'Pembayaran berhasil' }).waitFor();
    await payTab.close();
    await prem.bringToFront();
    await prem.getByRole('button', { name: 'Cek status pembayaran' }).click();
    await prem.locator('#msg', { hasText: 'Pembayaran berhasil' }).waitFor({ timeout: 10000 });
    await prem.locator('.badge.premium').waitFor();
  });

  await step('UC-PRM-04: status & masa aktif langganan tampil', async () => {
    assert.match(await prem.locator('#berlaku').innerText(), /\d{4}/);
    assert.equal(await prem.getByRole('button', { name: 'Perpanjang 30 hari' }).count(), 1);
  });

  await step('halaman Premium lolos audit aksesibilitas', async () => assert.deepEqual(await a11yAudit(prem), []));
  await prem.screenshot({ path: path.join(shotsDir, '05-premium.png'), fullPage: true });

  await step('setelah Premium: kuota tanpa batas di panel', async () => {
    await page.bringToFront();
    await page.locator('#nv-list').focus();
    await page.keyboard.press('Enter');
    await status.filter({ hasText: /Deskripsi gambar 2 siap\.$/ }).waitFor({ timeout: 10000 });
  });

  await step('setelah Premium: nada & jenis suara terbuka di pengaturan', async () => {
    await set.reload();
    await set.locator('#nada').waitFor();
    assert.equal(await set.locator('#nada').isDisabled(), false);
    await set.locator('#nada').fill('1.3');
    await set.getByRole('button', { name: 'Simpan pengaturan' }).click();
    await set.locator('#msg', { hasText: 'Pengaturan berhasil disimpan.' }).waitFor();
  });
  await set.close();
  await prem.close();

  // =========================================================================
  section('Profil (UC-AKUN-02..03)');
  const prof = await context.newPage();
  watch(prof);
  await prof.goto(extPage('pages/profil.html'));

  await step('UC-AKUN-02: profil menampilkan status Premium', async () => {
    await prof.locator('#p-jenis', { hasText: 'Premium' }).waitFor();
  });

  await step('UC-AKUN-03: ubah nama', async () => {
    await prof.getByLabel('Nama', { exact: true }).fill('Rifat Arifaldo');
    await prof.getByRole('button', { name: 'Simpan perubahan' }).click();
    await prof.locator('#p-nama', { hasText: 'Rifat Arifaldo' }).waitFor();
  });

  await step('UC-AKUN-03 alt: sandi baru terlalu pendek ditolak', async () => {
    await prof.getByLabel('Kata sandi saat ini (wajib bila mengganti kata sandi)').fill('sandiku123');
    await prof.getByLabel('Kata sandi baru').fill('123');
    await prof.getByRole('button', { name: 'Simpan perubahan' }).click();
    await prof.locator('#msg', { hasText: 'minimal 8 karakter' }).waitFor();
  });

  await step('halaman profil lolos audit aksesibilitas', async () => assert.deepEqual(await a11yAudit(prof), []));
  await prof.screenshot({ path: path.join(shotsDir, '06-profil.png'), fullPage: true });
  await prof.close();

  // =========================================================================
  section('Dashboard Admin (UC-ADM-01..04, UC-LAP-02..03)');
  const adm = await context.newPage();
  watch(adm);
  await adm.goto(`${backend.base}/admin/`);

  await step('login Admin', async () => {
    await adm.locator('#login-email').fill(ADMIN.email);
    await adm.locator('#login-password').fill(ADMIN.password);
    await adm.getByRole('button', { name: 'Masuk' }).click();
    await adm.locator('#app-view:not([hidden])').waitFor();
  });

  await step('UC-ADM-02: daftar pengguna menampilkan pengguna Premium', async () => {
    const row = adm.locator('#users-body tr', { hasText: 'rifat@uji.id' });
    await row.waitFor();
    assert.match(await row.innerText(), /Premium/);
  });

  await step('UC-ADM-01: tambah pengguna', async () => {
    await adm.getByRole('button', { name: 'Tambah pengguna' }).click();
    const dlg = adm.locator('#user-dialog');
    await dlg.getByLabel('Nama').fill('Dewi Penguji');
    await dlg.getByLabel('Email').fill('dewi@uji.id');
    await dlg.getByLabel('Kata sandi').fill('sandidewi1');
    await dlg.getByRole('button', { name: 'Simpan' }).click();
    await adm.locator('#toast', { hasText: 'Pengguna baru berhasil ditambahkan.' }).waitFor();
  });

  await step('UC-ADM-02 alt: pencarian', async () => {
    await adm.getByLabel('Cari nama atau email').fill('dewi');
    await adm.getByRole('button', { name: 'Cari' }).click();
    await adm.locator('#users-caption', { hasText: '1 pengguna' }).waitFor();
  });

  await step('UC-ADM-03: nonaktifkan akun', async () => {
    await adm.getByRole('button', { name: 'Ubah Dewi Penguji' }).click();
    const dlg = adm.locator('#user-dialog');
    await dlg.getByLabel('Status akun').selectOption('nonaktif');
    await dlg.getByRole('button', { name: 'Simpan' }).click();
    await adm.locator('#users-body tr', { hasText: 'Nonaktif' }).waitFor();
  });

  await step('UC-ADM-04: hapus pengguna dengan konfirmasi', async () => {
    await adm.getByRole('button', { name: 'Hapus Dewi Penguji' }).click();
    await adm.getByRole('button', { name: 'Hapus permanen' }).click();
    await adm.locator('#toast', { hasText: 'berhasil dihapus' }).waitFor();
  });

  await step('dashboard pengguna lolos audit aksesibilitas', async () => assert.deepEqual(await a11yAudit(adm), []));
  await adm.getByLabel('Cari nama atau email').fill('');
  await adm.getByRole('button', { name: 'Cari' }).click();
  await adm.locator('#users-body tr').first().waitFor();
  await adm.screenshot({ path: path.join(shotsDir, '07-admin-pengguna.png'), fullPage: true });

  await step('UC-LAP-02: laporan tampil dengan deskripsi & alasan', async () => {
    await adm.getByRole('tab', { name: 'Laporan deskripsi' }).click();
    const item = adm.locator('.report').first();
    await item.waitFor();
    assert.match(await item.innerText(), /Warnanya biru, bukan kucing\./);
  });

  await step('UC-LAP-03: tandai sudah ditinjau dengan tindak lanjut', async () => {
    await adm.getByRole('button', { name: 'Tinjau' }).first().click();
    await adm.getByLabel('Tindak lanjut').fill('Dicatat untuk evaluasi model.');
    await adm.locator('#review-dialog').getByRole('button', { name: 'Simpan' }).click();
    await adm.locator('#toast', { hasText: 'Status laporan berhasil diperbarui.' }).waitFor();
    const r = await backend.db.get('SELECT status_laporan, tindak_lanjut FROM laporan_deskripsi');
    assert.equal(r.status_laporan, 'ditinjau');
  });
  await adm.locator('#report-filter').selectOption('');
  await adm.locator('.report').first().waitFor();
  await adm.screenshot({ path: path.join(shotsDir, '08-admin-laporan.png'), fullPage: true });
  await adm.close();

  // =========================================================================
  section('Kondisi gagal (RNF-06, RNF-12)');

  await step('belum masuk → panel meminta login & menawarkan tombol Masuk', async () => {
    await sw.evaluate(() => chrome.storage.local.remove(['nvSession', 'nvTts']));
    await page.bringToFront();
    await page.reload();
    await toggleOn(`${SITE}/berita.html`);
    await page.locator('#nv-list').focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await status.filter({ hasText: 'Anda belum masuk' }).waitFor({ timeout: 10000 });
    assert.equal(await page.getByRole('button', { name: 'Masuk atau daftar NaraVisi' }).isVisible(), true);
  });

  await step('Alt+Shift+N saat belum masuk → dibacakan & tab masuk terbuka, fokus di Email', async () => {
    const [tab] = await Promise.all([
      context.waitForEvent('page'),
      sw.evaluate(() => globalThis.naraVisi.handleScanCommand()),
    ]);
    await tab.waitForURL(/selamat-datang\.html#masuk$/);
    await tab.waitForFunction(() => document.activeElement?.id === 'login-email');
    assert.equal((await spoken()).at(-1), 'Anda belum masuk. Halaman masuk dibuka.');
    await tab.close();
  });

  await step('server mati → pesan koneksi dibacakan', async () => {
    await sw.evaluate(() => chrome.storage.local.set({ nvSession: { token: 'x', user: null } }));
    await sw.evaluate(() => chrome.storage.sync.set({ apiBase: 'http://127.0.0.1:9/api/v1' }));
    await page.bringToFront();
    await page.keyboard.press('Escape');
    await toggleOn(`${SITE}/berita.html`);
    await page.locator('#nv-list').focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await status.filter({ hasText: 'Tidak dapat terhubung ke server' }).waitFor({ timeout: 15000 });
    assert.match(await host.getAttribute('data-last-spoken'), /Tidak dapat terhubung/);
  });

  await step('halaman tanpa gambar → "Tidak ada gambar"', async () => {
    await page.goto(`${SITE}/kosong.html`);
    const res = await toggleOn(`${SITE}/kosong.html`);
    assert.equal(res.count, 0);
    await status.filter({ hasText: 'Tidak ada gambar' }).waitFor();
  });

  await step('halaman chrome:// → pesan, tidak crash', async () => {
    const p2 = await context.newPage();
    await p2.goto('chrome://version');
    await p2.bringToFront();
    const res = await sw.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      return globalThis.naraVisi.togglePanel(tab.id);
    });
    assert.equal(res.ok, false);
    assert.match(res.message, /tidak dapat diakses/);
    await p2.close();
  });

  await step('tidak ada error JavaScript di semua halaman', async () => assert.deepEqual(pageErrors, []));
} finally {
  await context.close();
  site.close();
  await backend.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} skenario lulus`);
process.exit(failed.length ? 1 : 0);
