// Uji end-to-end NaraVisi (Fase 6) di Chromium dengan Playwright.
//
// Yang berjalan sungguhan: extension (MV3), backend NaraVisi (semua service + rute,
// basis data SQLite di memori), dashboard Admin. Yang dipalsukan: model AI
// (mengembalikan teks tetap) — supaya uji cepat dan tidak butuh GPU/unduhan model.
//
// Jalankan: cd e2e && npm install && npm test

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
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
const uiDir = path.join(shotsDir, 'ui-v2'); // salinan terpilih disimpan di docs/gambar/ui-v2/
mkdirSync(uiDir, { recursive: true });

const { startTestApp, ADMIN } = await import('../backend/test/support/testApp.js');

// ---------------------------------------------------------------------------
// Backend NaraVisi (rute & service asli) + situs uji berisi gambar
// ---------------------------------------------------------------------------
const backend = await startTestApp();
backend.clock.set(new Date().toISOString()); // jam nyata agar token & tanggal wajar
backend.ai.inFlight = 0;
backend.ai.maxInFlight = 0;
backend.ai.delayMs = 0;
backend.ai.caption = async ({ lang, imageBase64, context }) => {
  backend.ai.calls += 1;
  backend.ai.lastLang = lang;
  backend.ai.lastImage = imageBase64;
  backend.ai.lastContext = context;
  backend.ai.inFlight += 1; // dipakai uji "baca berurutan tidak pernah paralel"
  backend.ai.maxInFlight = Math.max(backend.ai.maxInFlight, backend.ai.inFlight);
  if (backend.ai.delayMs) await new Promise((r) => setTimeout(r, backend.ai.delayMs));
  backend.ai.inFlight -= 1;
  const mime = Buffer.from(imageBase64, 'base64')[0] === 0xff ? 'JPEG' : 'PNG';
  return { text: `Deskripsi uji untuk gambar ${mime}.`, textEn: null, lang, model: 'fake', latencyMs: 1, jenis: 'foto', provider: 'fake' };
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
  '/img/pantai.jpg': { type: 'image/jpeg', body: await solid(600, 300, '#20a0c0').jpeg().toBuffer() },
  '/img/sprite.png': { type: 'image/png', body: await solid(200, 200, '#555').png().toBuffer() },
  // Bukan "logo.svg": nama file berisi logo/ikon/avatar/iklan kini disaring sebagai bukan konten.
  '/img/grafik.svg': {
    type: 'image/svg+xml',
    body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><circle cx="100" cy="100" r="90" fill="orange"/></svg>'),
  },
};
// Halaman artikel: filter (ikon 50×50, alt="", logo situs), urutan (<main> dulu, lalu terbesar), keterangan.
for (const [name, w, h, rgb] of [
  ['logo-situs.png', 200, 100, '#000080'], ['samping.jpg', 500, 300, '#808000'], ['banjir.jpg', 400, 250, '#4060a0'],
  ['ikon.png', 50, 50, '#a04060'], ['dekor.png', 300, 200, '#c0c0c0'], ['foto-1.jpg', 300, 200, '#60a040'],
  ['peta.jpg', 260, 200, '#a0a040'], ['foto-2.jpg', 250, 200, '#40a0a0'], ['foto-3.jpg', 220, 180, '#a06040'],
]) {
  const img = solid(w, h, rgb);
  fixtures[`/img/${name}`] = name.endsWith('.png')
    ? { type: 'image/png', body: await img.png().toBuffer() }
    : { type: 'image/jpeg', body: await img.jpeg().toBuffer() };
}
const articleBody = `
  <header><img class="site-logo" src="/img/logo-situs.png" width="200" height="100"><a id="awal" href="#">Beranda</a></header>
  <aside><img id="samping" src="/img/samping.jpg" width="500" height="300"></aside>
  <main><article><h1>Banjir</h1>
    <figure><img id="banjir" src="/img/banjir.jpg" width="400" height="250"><figcaption>Banjir di Samarinda</figcaption></figure>
    <img id="ikon" src="/img/ikon.png" width="50" height="50">
    <img id="dekor" src="/img/dekor.png" alt="" width="300" height="200">
    <img id="foto1" src="/img/foto-1.jpg" width="300" height="200">
    <img id="peta" src="/img/peta.jpg" alt="Peta jalur evakuasi" width="260" height="200">
    <img id="foto2" src="/img/foto-2.jpg" width="250" height="200">
    <img id="foto3" src="/img/foto-3.jpg" width="220" height="180">
  </article></main>`;
const articlePage = `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Artikel Uji</title></head>
<body style="font-family:sans-serif;padding:20px">${articleBody}</body></html>`;
// Tahap 2: urutan baca (DOM vs CSS grid order), alt generik digabung, baca berurutan + IntersectionObserver.
for (const [name, rgb] of [
  ['kucing.jpg', '#c08040'], ['anjing.jpg', '#4080c0'], ['burung.jpg', '#40c080'],
  ['g1.jpg', '#802020'], ['g2.jpg', '#208020'], ['g3.jpg', '#202080'], ['g4.jpg', '#808020'],
  ['p1.jpg', '#a02060'], ['p2.jpg', '#2060a0'], ['p3.jpg', '#60a020'], ['p4.jpg', '#a0a0a0'],
]) fixtures[`/img/${name}`] = { type: 'image/jpeg', body: await solid(300, 200, rgb).jpeg().toBuffer() };
const html = (title, body) => `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>${title}</title></head><body style="margin:0;padding:20px">${body}</body></html>`;
// DOM: kucing, anjing (lebih besar & tampil di atas lewat position:absolute — bukan reorder CSS), burung.
const orderDomPage = html('Urutan DOM', `<main style="position:relative;padding-top:260px">
  <img id="kucing" src="/img/kucing.jpg" width="200" height="140">
  <img id="anjing" src="/img/anjing.jpg" width="400" height="240" style="position:absolute;top:0;left:0">
  <img id="burung" src="/img/burung.jpg" width="200" height="140"></main>`);
// Grid dengan order CSS: DOM kucing, anjing, burung → tampil anjing, burung, kucing.
const orderGridPage = html('Urutan Grid', `<main><div style="display:grid;grid-template-columns:repeat(3,220px);gap:8px">
  <img id="kucing" src="/img/kucing.jpg" width="200" height="140" style="order:3">
  <img id="anjing" src="/img/anjing.jpg" width="200" height="140" style="order:1">
  <img id="burung" src="/img/burung.jpg" width="200" height="140" style="order:2"></div></main>`);
const altPage = html('Alt Uji', `<main>
  <img id="g1" src="/img/g1.jpg" alt="image" width="300" height="200">
  <img id="g2" src="/img/g2.jpg" alt="IMG_2041.jpg" width="300" height="200">
  <img id="g3" src="/img/g3.jpg" alt="Petugas membagikan masker di pasar" width="300" height="200">
  <img id="g4" src="/img/g4.jpg" width="300" height="200"></main>`);
// p3 & p4 jauh di bawah layar: baru diproses setelah digulir.
const longPage = html('Panjang', `<main>
  <img id="p1" src="/img/p1.jpg" width="300" height="200"><img id="p2" src="/img/p2.jpg" width="300" height="200">
  <div style="height:4000px"></div>
  <img id="p3" src="/img/p3.jpg" width="300" height="200"><img id="p4" src="/img/p4.jpg" width="300" height="200"></main>`);
const passwordPage = `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Masuk Bank Uji</title></head>
<body>${articleBody}<form><label>Sandi <input type="password"></label></form></body></html>`;
const linkPage = `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Tautan Uji</title></head>
<body><main><a id="awal" href="#">Mulai</a><p><a id="tautan-gambar" href="#promo"><img src="/img/foto-3.jpg" width="220" height="180"></a></p></main></body></html>`;
const inlinePng = `data:image/png;base64,${(await solid(120, 120, '#f0c020').png().toBuffer()).toString('base64')}`;
const testPage = `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Berita Uji</title></head>
<body style="font-family:sans-serif;padding:20px">
  <h1>Berita Uji</h1><a href="#" id="page-link">Tautan halaman</a>
  <p><img src="/img/wide.png" width="400" height="250"></p>
  <p><img src="/img/photo.jpg" alt="Foto produk sepatu" width="300" height="300"></p>
  <p><img src="/img/tiny.png" alt="ikon" width="16" height="16"> ikon kecil</p>
  <p><img src="/img/hidden.png" style="display:none" alt="tersembunyi"></p>
  <p><img src="/img/modern.avif" width="320" height="200"></p>
  <p><img src="/img/grafik.svg" alt="Grafik lingkaran" width="200" height="200"></p>
  <p><img src="${inlinePng}" width="120" height="120" alt="Gambar inline"></p>
  <p><img src="/img/photo.jpg" alt="duplikat" width="150" height="150"></p>
</body></html>`;
// SVG inline, gambar latar CSS, dan yang harus diabaikan (ikon dekoratif, sprite kecil, gradien).
const vectorPage = `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Infografik Uji</title>
<style>.batang { fill: #e03030; } .hero { width: 300px; height: 150px; background: url('/img/pantai.jpg') center / cover; }</style></head>
<body style="font-family:sans-serif;padding:20px">
  <h1>Infografik Uji</h1>
  <svg id="grafik" width="200" height="120" viewBox="0 0 200 120"><title>Grafik penjualan</title>
    <rect class="batang" x="0" y="0" width="200" height="120"/></svg>
  <svg width="0" height="0" style="position:absolute"><symbol id="bulat" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="#20a040"/></symbol></svg>
  <svg id="peta" width="120" height="120" aria-label="Peta lokasi"><use href="#bulat" width="120" height="120"/><use href="#bulat" width="60" height="60"/></svg>
  <svg aria-hidden="true" width="200" height="200"><circle cx="100" cy="100" r="90"/></svg>
  <svg width="20" height="20"><circle cx="10" cy="10" r="9"/></svg>
  <div class="hero" role="img" aria-label="Pemandangan pantai"></div>
  <div style="width:200px;height:200px;background-image:url(/img/grafik.svg)"></div>
  <span style="display:inline-block;width:20px;height:20px;background:url(/img/sprite.png)"></span>
  <div style="width:300px;height:100px;background:linear-gradient(red, blue)"></div>
</body></html>`;
const site = http.createServer((req, res) => {
  if (req.url.startsWith('/rusak/')) {
    res.writeHead(500, { 'content-type': 'text/html' });
    return res.end('<h1>Internal Server Error</h1>');
  }
  if (req.url === '/infografik.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(vectorPage);
  }
  if (req.url === '/' || req.url === '/berita.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(testPage);
  }
  const pages = { '/urutan-dom.html': orderDomPage, '/urutan-grid.html': orderGridPage, '/alt.html': altPage, '/panjang.html': longPage, '/artikel.html': articlePage, '/artikel-2.html': articlePage, '/artikel-3.html': articlePage, '/masuk.html': passwordPage, '/tautan.html': linkPage };
  if (pages[req.url]) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(pages[req.url]);
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

/** Rasio kontras WCAG 2.x antara dua warna #RRGGBB. */
function contrast(a, b) {
  const lum = (hex) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Token warna dari shared/tokens.css: { light: {--nv-x: '#..'}, dark: {...} } */
function readTokens() {
  const css = readFileSync(path.join(extensionDir, 'shared/tokens.css'), 'utf8');
  const block = (src) => Object.fromEntries([...src.matchAll(/(--nv-[\w-]+):\s*(#[0-9A-Fa-f]{6})/g)].map((m) => [m[1], m[2].toUpperCase()]));
  const darkStart = css.indexOf('@media (prefers-color-scheme: dark)');
  return { light: block(css.slice(0, darkStart)), dark: block(css.slice(darkStart)) };
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
  section('Identitas visual v2 (token, kontras, ikon)');

  await step('kontras token: teks ≥ 4.5:1, komponen & fokus ≥ 3:1 (terang & gelap)', async () => {
    const report = [];
    for (const [mode, t] of Object.entries(readTokens())) {
      const pairs = [
        ['teks utama', '--nv-ink', '--nv-paper', 4.5], ['teks utama/kartu', '--nv-ink', '--nv-surface', 4.5],
        ['teks redup', '--nv-ink-muted', '--nv-paper', 4.5], ['teks redup/kartu', '--nv-ink-muted', '--nv-surface', 4.5],
        ['teks redup/sorotan', '--nv-ink-muted', '--nv-tint', 4.5], ['teks/sorotan', '--nv-ink', '--nv-tint', 4.5],
        ['tombol utama', '--nv-on-ink', '--nv-ink', 4.5],
        ['error', '--nv-error', '--nv-paper', 4.5], ['error/kotak error', '--nv-error', '--nv-error-bg', 4.5],
        ['sukses', '--nv-ok', '--nv-paper', 4.5], ['sukses/kotak sukses', '--nv-ok', '--nv-ok-bg', 4.5],
        ['batas kolom', '--nv-field', '--nv-surface', 3], ['batas kolom/latar', '--nv-field', '--nv-paper', 3],
        ['fokus: cincin dalam/latar', '--nv-focus-inner', '--nv-paper', 3, mode === 'light'],
        ['fokus: marigold/cincin dalam', '--nv-marigold', '--nv-focus-inner', 3],
        ['fokus: marigold/latar (gelap)', '--nv-marigold', '--nv-paper', 3, mode === 'dark'],
      ];
      for (const [name, fg, bg, min, applies = true] of pairs) {
        if (!applies) continue;
        const ratio = contrast(t[fg], t[bg]);
        report.push(`${mode.padEnd(5)} ${name.padEnd(30)} ${ratio.toFixed(2)}:1`);
        assert.ok(ratio >= min, `${mode} ${name}: ${ratio.toFixed(2)} < ${min}`);
      }
    }
    console.log(report.map((r) => `      ${r}`).join('\n'));
  });

  await step('panel content script memakai nilai token yang sama dengan tokens.css', async () => {
    const panel = readFileSync(path.join(extensionDir, 'content/content.js'), 'utf8');
    const { light, dark } = readTokens();
    const darkAt = panel.indexOf('@media (prefers-color-scheme: dark)');
    for (const [name, value] of Object.entries(light)) assert.ok(panel.slice(0, darkAt).includes(`${name}: ${value};`), `${name} terang`);
    for (const [name, value] of Object.entries(dark)) assert.ok(panel.slice(darkAt).includes(`${name}: ${value};`), `${name} gelap`);
  });

  await step('ikon 16/32/48/128 px tersedia dan berukuran benar', async () => {
    for (const size of [16, 32, 48, 128]) {
      const meta = await sharp(path.join(extensionDir, `icons/icon${size}.png`)).metadata();
      assert.deepEqual([meta.width, meta.height], [size, size]);
    }
  });

  // =========================================================================
  section('Pemandu suara saat pertama dipasang');
  await step('tab sambutan terbuka, fokus di judul, sambutan dibacakan; Tab → kolom Email', async () => {
    const welcome =
      context.pages().find((p) => p.url().includes('selamat-datang.html')) ??
      (await context.waitForEvent('page', { predicate: (p) => p.url().includes('selamat-datang.html'), timeout: 10000 }));
    watch(welcome);
    await welcome.waitForFunction(() => document.activeElement?.id === 'title');
    assert.match((await spoken())[0], /^Selamat datang di NaraVisi\. Tekan Tab untuk masuk atau mendaftar\. Setelah masuk: (Tekan .+|Pintasan belum diatur\. Klik ikon NaraVisi di toolbar) untuk mendengar deskripsi gambar\.$/);
    assert.deepEqual(await a11yAudit(welcome), []);
    assert.equal(await welcome.locator('#register-form').isVisible(), false);
    await welcome.keyboard.press('Tab'); // pilihan Masuk/Daftar (tablist) ada di atas form
    assert.equal(await welcome.evaluate(() => document.activeElement.id), 'tab-login');
    await welcome.keyboard.press('Tab');
    assert.equal(await welcome.evaluate(() => document.activeElement.id), 'login-email');
    await welcome.close();
  });

  // =========================================================================
  section('Akun lewat popup (UC-AKUN-01, UC-AKUN-05)');
  const popup = await context.newPage();
  watch(popup);
  await popup.setViewportSize({ width: 360, height: 600 });
  await popup.goto(extPage('popup/popup.html'));

  await step('popup belum masuk menampilkan formulir login dengan fokus di email', async () => {
    await popup.locator('#guest:not([hidden])').waitFor();
    assert.equal(await popup.evaluate(() => document.activeElement.id), 'login-email');
  });

  const visibleForms = () => popup.locator('form.auth-form:visible').count();

  await step('popup belum masuk: hanya form Masuk yang terlihat (isVisible)', async () => {
    assert.equal(await popup.locator('#login-form').isVisible(), true);
    assert.equal(await popup.locator('#register-form').isVisible(), false);
    assert.equal(await popup.getByLabel('Nama').isVisible(), false);
    assert.equal(await visibleForms(), 1);
    assert.equal(await popup.getByText('Masuk untuk mulai mendeskripsikan gambar.').isVisible(), true);
  });

  await step('status server di kaki popup: titik + "Server terhubung"', async () => {
    await popup.locator('#health', { hasText: /^Server terhubung/ }).waitFor();
    assert.equal(await popup.locator('#health-dot').getAttribute('data-state'), 'ok');
    assert.equal(await popup.locator('details').count(), 0); // bukan lagi <details> tersembunyi
    assert.equal(await popup.locator('#api-base').count(), 0); // alamat API pindah ke Pengaturan
  });

  await popup.screenshot({ path: path.join(uiDir, '01-popup-masuk.png'), fullPage: true });

  await step('Masuk/Daftar: tablist dengan panah kiri/kanan, Home/End; hanya satu form tampil', async () => {
    const tabLogin = popup.getByRole('tab', { name: 'Masuk' });
    const tabRegister = popup.getByRole('tab', { name: 'Daftar' });
    assert.equal(await popup.getByRole('tablist').count(), 1);
    await popup.keyboard.press('Shift+Tab'); // dari kolom Email ke tab terpilih
    assert.equal(await popup.evaluate(() => document.activeElement.id), 'tab-login');
    assert.equal(await tabLogin.getAttribute('aria-selected'), 'true');
    assert.equal(await tabRegister.getAttribute('tabindex'), '-1'); // roving tabindex

    await popup.keyboard.press('ArrowRight');
    assert.equal(await popup.evaluate(() => document.activeElement.id), 'tab-register');
    assert.equal(await tabRegister.getAttribute('aria-selected'), 'true');
    assert.equal(await tabLogin.getAttribute('aria-selected'), 'false');
    assert.equal(await popup.locator('#register-form').isVisible(), true);
    assert.equal(await popup.locator('#login-form').isVisible(), false);
    assert.equal(await visibleForms(), 1);
    assert.equal(await popup.getByRole('heading', { name: 'Buat akun baru' }).isVisible(), true);
    assert.equal(await popup.getByText('Masuk untuk mulai mendeskripsikan gambar.').isVisible(), false);

    await popup.keyboard.press('ArrowRight'); // berputar ke awal
    assert.equal(await popup.evaluate(() => document.activeElement.id), 'tab-login');
    assert.equal(await popup.locator('#login-form').isVisible(), true);
    await popup.keyboard.press('End');
    assert.equal(await popup.evaluate(() => document.activeElement.id), 'tab-register');
    await popup.keyboard.press('Home');
    assert.equal(await popup.evaluate(() => document.activeElement.id), 'tab-login');
    assert.equal(await popup.getByRole('heading', { name: 'Masuk ke NaraVisi' }).isVisible(), true);
    await popup.keyboard.press('Tab'); // urutan Tab: tab terpilih → kolom pertama form
    assert.equal(await popup.evaluate(() => document.activeElement.id), 'login-email');
    assert.equal(await visibleForms(), 1);
  });

  await step('fokus keyboard: outline marigold 3px + cincin tinta (tidak pernah dihapus)', async () => {
    const ring = await popup.evaluate(() => {
      const s = getComputedStyle(document.activeElement);
      return { style: s.outlineStyle, width: s.outlineWidth, color: s.outlineColor, shadow: s.boxShadow };
    });
    assert.deepEqual([ring.style, ring.width, ring.color], ['solid', '3px', 'rgb(232, 163, 61)']);
    assert.match(ring.shadow, /rgb\(20, 33, 61\) 0px 0px 0px 2px/);
  });

  await step('ikon mata: type & aria-label berganti, fokus tetap di tombol, kursor tidak hilang', async () => {
    const input = popup.locator('#login-password');
    const eye = popup.locator('#login-form .reveal');
    assert.equal(await eye.getAttribute('type'), 'button');
    assert.equal(await eye.getAttribute('aria-controls'), 'login-password');
    assert.equal(await eye.locator('svg[aria-hidden="true"]').count(), 1);
    assert.equal(await eye.locator('svg').getAttribute('stroke'), 'currentColor');
    const box = await eye.boundingBox();
    assert.ok(box.width >= 44 && box.height >= 44, `area klik ${box.width}×${box.height}`);
    const field = await input.boundingBox(); // ikon berada di dalam kolom, sisi kanan
    assert.ok(box.x > field.x + field.width / 2 && box.x + box.width <= field.x + field.width && box.y >= field.y && box.y + box.height <= field.y + field.height);

    await input.fill('rahasia123');
    await input.evaluate((el) => el.setSelectionRange(3, 3));
    await eye.focus();
    await popup.keyboard.press('Enter');
    assert.equal(await input.getAttribute('type'), 'text');
    assert.equal(await eye.getAttribute('aria-label'), 'Sembunyikan kata sandi');
    assert.equal(await eye.getAttribute('aria-pressed'), 'true');
    assert.equal(await eye.locator('path').count(), 2); // mata dicoret
    assert.equal(await popup.evaluate(() => document.activeElement.className), 'reveal');
    assert.deepEqual(await input.evaluate((el) => [el.selectionStart, el.selectionEnd]), [3, 3]);

    await eye.click();
    assert.equal(await input.getAttribute('type'), 'password');
    assert.equal(await eye.getAttribute('aria-label'), 'Tampilkan kata sandi');
    assert.equal(await eye.getAttribute('aria-pressed'), 'false');
    assert.equal(await popup.evaluate(() => document.activeElement.className), 'reveal');
    assert.deepEqual(await input.evaluate((el) => [el.selectionStart, el.selectionEnd]), [3, 3]);
    assert.equal(await popup.getByRole('button', { name: 'Tampilkan kata sandi', includeHidden: true }).count(), 2); // Masuk & Daftar
  });

  await step('server belum berjalan → pesan "tidak menjawab" + tombol Coba lagi', async () => {
    await sw.evaluate(() => chrome.storage.sync.set({ apiBase: 'http://127.0.0.1:9/api/v1' }));
    await popup.getByLabel('Email').first().fill('belum@uji.id');
    await popup.getByRole('button', { name: 'Masuk', exact: true }).click();
    const msg = popup.locator('#message');
    await msg.filter({ hasText: 'Tidak dapat terhubung ke server NaraVisi: 127.0.0.1:9 tidak menjawab.' }).waitFor({ timeout: 10000 });
    assert.equal(await msg.getAttribute('aria-live'), 'polite');
    assert.equal(await msg.getAttribute('data-tone'), 'error');
    assert.equal(await popup.getByRole('button', { name: 'Coba lagi' }).isVisible(), true);
    assert.equal(await popup.locator('#message button').count(), 0); // tombol di luar area aria-live
    assert.match((await spoken()).at(-1), /tidak menjawab/);
    await popup.getByRole('button', { name: 'Coba lagi' }).click(); // juga memeriksa ulang status server
    await popup.locator('#health', { hasText: 'Server tidak aktif' }).waitFor();
    assert.equal(await popup.locator('#health-dot').getAttribute('data-state'), 'off');
    assert.equal(await popup.getByRole('button', { name: 'Atur server' }).isVisible(), true);
  });

  await step('server menjawab tetapi galat 500 → pesan berbeda + Coba lagi', async () => {
    await sw.evaluate((base) => chrome.storage.sync.set({ apiBase: base }), `${SITE}/rusak/api/v1`);
    await popup.getByRole('button', { name: 'Masuk', exact: true }).click();
    await popup.locator('#message', { hasText: 'Server NaraVisi menjawab, tetapi sedang bermasalah (kode 500).' }).waitFor({ timeout: 10000 });
    assert.equal(await popup.getByRole('button', { name: 'Coba lagi' }).isVisible(), true);
  });

  await step('server kembali → Coba lagi mengirim ulang form; galat isian tidak menawarkan Coba lagi', async () => {
    await sw.evaluate((base) => chrome.storage.sync.set({ apiBase: base }), API);
    await popup.getByRole('button', { name: 'Coba lagi' }).click();
    await popup.locator('#message', { hasText: 'Email atau kata sandi salah.' }).waitFor({ timeout: 10000 });
    assert.equal(await popup.getByRole('button', { name: 'Coba lagi' }).isVisible(), false);
    assert.equal(await popup.evaluate(() => document.activeElement.id), 'message'); // fokus tidak hilang ke <body>
    await popup.locator('#health', { hasText: /^Server terhubung/ }).waitFor();
    await popup.getByLabel('Email').first().fill('');
    await popup.getByLabel('Kata sandi', { exact: true }).fill('');
  });

  await step('klik tab "Daftar" → hanya form Daftar terlihat, fokus tetap di tab', async () => {
    await popup.getByRole('tab', { name: 'Daftar' }).click();
    assert.equal(await popup.locator('#register-form').isVisible(), true);
    assert.equal(await popup.locator('#login-form').isVisible(), false);
    assert.equal(await popup.evaluate(() => document.activeElement.id), 'tab-register');
  });
  await popup.mouse.move(0, 0);
  await popup.waitForTimeout(200); // tunggu transisi hover (120 ms) selesai
  await popup.screenshot({ path: path.join(uiDir, '02-popup-daftar.png'), fullPage: true });

  await step('Daftar dengan kolom kosong → error per kolom, aria-invalid, fokus ke Nama', async () => {
    await popup.getByRole('button', { name: 'Daftar', exact: true }).click();
    assert.equal(await popup.evaluate(() => document.activeElement.id), 'reg-name');
    assert.equal(await popup.locator('#reg-name').getAttribute('aria-invalid'), 'true');
    assert.equal(await popup.locator('#reg-name').getAttribute('aria-describedby'), 'reg-name-error');
    assert.equal(await popup.locator('#reg-name-error').innerText(), 'Nama wajib diisi.');
    assert.equal(await popup.locator('#reg-password-error').isVisible(), true);
    assert.equal(await popup.locator('#message').innerText(), 'Nama wajib diisi.');
    // Error tampil tepat di bawah kolomnya
    const [field, err] = await Promise.all([popup.locator('#reg-name').boundingBox(), popup.locator('#reg-name-error').boundingBox()]);
    assert.ok(err.y >= field.y + field.height);
  });
  await popup.screenshot({ path: path.join(uiDir, '03-popup-daftar-error.png'), fullPage: true });

  await step('tombol ikon mata di form Daftar (aria-pressed) menampilkan & menyembunyikan sandi', async () => {
    assert.equal(await popup.locator('#register-form').getByRole('button', { name: 'Tampilkan kata sandi' }).count(), 1);
    const btn = popup.locator('#register-form .reveal'); // nama tombol berganti setelah ditekan
    await btn.click();
    assert.equal(await btn.getAttribute('aria-pressed'), 'true');
    assert.equal(await btn.getAttribute('aria-label'), 'Sembunyikan kata sandi');
    assert.equal(await popup.locator('#reg-password').getAttribute('type'), 'text');
    await btn.click();
    assert.equal(await btn.getAttribute('aria-pressed'), 'false');
    assert.equal(await btn.getAttribute('aria-label'), 'Tampilkan kata sandi');
    assert.equal(await popup.locator('#reg-password').getAttribute('type'), 'password');
  });

  await step('mode gelap: popup belum masuk', async () => {
    const dark = await context.newPage();
    watch(dark);
    await dark.emulateMedia({ colorScheme: 'dark' });
    await dark.setViewportSize({ width: 360, height: 600 });
    await dark.goto(extPage('popup/popup.html'));
    await dark.locator('#guest:not([hidden])').waitFor();
    await dark.locator('#health', { hasText: /^Server terhubung/ }).waitFor();
    assert.equal(await dark.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(17, 26, 44)');
    await dark.screenshot({ path: path.join(uiDir, '05-popup-masuk-gelap.png'), fullPage: true });
    await dark.close();
  });

  await step('registrasi dari popup → langsung masuk sebagai Gratis, kuota 10', async () => {
    await popup.getByLabel('Nama').fill('Rifat Uji');
    await popup.getByLabel('Email').last().fill('rifat@uji.id');
    await popup.getByLabel('Kata sandi (minimal 8 karakter)').fill('sandiku123');
    await popup.getByRole('button', { name: 'Daftar', exact: true }).click();
    await popup.locator('#member:not([hidden])').waitFor();
    assert.equal(await popup.locator('#quota .num').innerText(), '10');
    // "/" hanya visual (aria-hidden); pembaca layar mendengar "10 dari 10 gambar hari ini"
    assert.match(await popup.locator('#quota').innerText(), /^10 \/\s+dari\s+10\s+gambar hari ini$/);
    assert.match(await popup.locator('#plan').innerText(), /^Akun Gratis/);
    assert.match((await spoken()).at(-1), /^Berhasil masuk sebagai Rifat Uji\. Jatah gratis hari ini 10 gambar\. (Tekan .+|Pintasan belum diatur\. Klik ikon NaraVisi di toolbar) untuk memindai gambar\.$/);
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

  await step('popup sudah masuk: sapaan, kartu kuota, tombol pindai + pintasan, menu berikon', async () => {
    assert.equal(await popup.evaluate(() => document.activeElement.id), 'scan');
    const scan = popup.getByRole('button', { name: /^Pindai gambar di halaman ini/ });
    assert.ok((await scan.boundingBox()).height >= 56);
    assert.match(await popup.locator('#shortcut').innerText(), /\S/);
    const menu = popup.getByRole('navigation', { name: 'Menu NaraVisi' });
    assert.deepEqual(await menu.getByRole('listitem').allInnerTexts(), ['Riwayat', 'Pengaturan', 'Upgrade Premium', 'Profil']);
    assert.equal(await menu.locator('svg[aria-hidden="true"]').count(), 8); // ikon + panah per baris
  });

  await step('Atkinson Hyperlegible dimuat dari berkas lokal (bukan internet)', async () => {
    await popup.evaluate(() => document.fonts.ready);
    const fonts = await popup.evaluate(() => [...document.fonts].filter((f) => f.family.includes('Atkinson') && f.status === 'loaded').map((f) => f.weight));
    assert.ok(fonts.includes('400') && fonts.includes('700'), `font termuat: ${fonts}`);
    assert.match(await popup.evaluate(() => getComputedStyle(document.body).fontFamily), /^"Atkinson Hyperlegible"/);
    assert.equal(await popup.evaluate(() => getComputedStyle(document.body).fontSize), '16px');
    assert.equal(await popup.evaluate(() => getComputedStyle(document.body).lineHeight), '24px');
  });

  await step('prefers-reduced-motion: transisi dimatikan; tanpa itu ≤ 150 ms', async () => {
    const dur = () => popup.evaluate(() => getComputedStyle(document.getElementById('logout')).transitionDuration);
    for (const d of (await dur()).split(',')) assert.ok(parseFloat(d) <= 0.15, d);
    await popup.emulateMedia({ reducedMotion: 'reduce' });
    assert.ok((await dur()).split(',').every((d) => parseFloat(d) === 0));
    await popup.emulateMedia({ reducedMotion: 'no-preference' });
  });

  await step('popup lolos audit aksesibilitas', async () => assert.deepEqual(await a11yAudit(popup), []));
  await popup.screenshot({ path: path.join(shotsDir, '01-popup.png') });
  await popup.mouse.move(0, 0);
  await popup.waitForTimeout(200); // tunggu transisi hover (120 ms) selesai
  await popup.screenshot({ path: path.join(uiDir, '04-popup-sudah-masuk.png'), fullPage: true });

  await step('mode gelap: popup sudah masuk', async () => {
    const dark = await context.newPage();
    watch(dark);
    await dark.emulateMedia({ colorScheme: 'dark' });
    await dark.setViewportSize({ width: 360, height: 600 });
    await dark.goto(extPage('popup/popup.html'));
    await dark.locator('#hello', { hasText: 'Halo, Rifat Uji.' }).waitFor();
    await dark.locator('#health', { hasText: /^Server terhubung/ }).waitFor();
    await dark.screenshot({ path: path.join(uiDir, '06-popup-sudah-masuk-gelap.png'), fullPage: true });
    await dark.close();
  });
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
    assert.match(list.at(-1), /^Ada 5 gambar\. (Tekan .+|Pintasan belum diatur\. Klik ikon NaraVisi di toolbar) untuk mendengar deskripsinya\.$/);
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
  section('Alur manual Alt+Shift+K (tidak boleh berubah)');
  await step('ALUR MANUAL: Alt+Shift+K → panel → panah → Enter → dibacakan → Esc', async () => {
    // 1. Pintasan di manifest tetap Alt+Shift+K dengan teks yang sama.
    const manifest = JSON.parse(readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
    assert.deepEqual(manifest.commands['scan-page'], {
      suggested_key: { default: 'Alt+Shift+K', mac: 'Alt+Shift+K' },
      description: 'Pindai gambar pada halaman ini',
    });
    const active = await sw.evaluate(async () => (await chrome.commands.getAll()).find((c) => c.name === 'scan-page'));
    assert.equal(active.description, 'Pindai gambar pada halaman ini');
    if (active.shortcut) assert.equal(active.shortcut, 'Alt+Shift+K');

    const manual = await context.newPage();
    watch(manual);
    await manual.goto(`${SITE}/berita.html`);
    await manual.focus('#page-link');
    const before = { calls: backend.ai.calls, last: (await backend.db.get('SELECT MAX(riwayat_id) AS id FROM riwayat_deskripsi')).id ?? 0 };
    // 2. Alt+Shift+K: Chrome memanggil chrome.commands.onCommand('scan-page', tab) → panel terbuka.
    //    (Playwright tidak bisa menekan pintasan level browser; yang dipanggil adalah pendengar yang sama.)
    await sw.evaluate(async (u) => {
      const [tab] = await chrome.tabs.query({ url: u });
      return globalThis.naraVisi.onCommand('scan-page', tab);
    }, `${SITE}/berita.html`);
    const st = manual.locator('#nv-status');
    await st.filter({ hasText: 'gambar ditemukan' }).waitFor();
    assert.equal(await manual.evaluate(() => document.querySelector('#naravisi-host').shadowRoot.activeElement?.id), 'nv-list');
    const selected = () => manual.evaluate(() => document.querySelector('#naravisi-host').shadowRoot.querySelector('[aria-selected="true"]')?.id);
    assert.equal(await selected(), 'nv-opt-0');
    // 3. Panah bawah/atas memilih gambar.
    await manual.keyboard.press('ArrowDown');
    assert.equal(await selected(), 'nv-opt-1');
    await manual.keyboard.press('ArrowUp');
    assert.equal(await selected(), 'nv-opt-0');
    // 4. Enter → dideskripsikan → teks tampil & dibacakan.
    await manual.keyboard.press('Enter');
    await manual.locator('#nv-text').filter({ hasText: 'Deskripsi uji untuk gambar' }).waitFor({ timeout: 10000 });
    assert.match(await manual.locator('#naravisi-host').getAttribute('data-last-spoken'), /^Deskripsi uji untuk gambar (PNG|JPEG)\.$/);
    assert.equal(backend.ai.calls - before.calls, 1);
    // 5. Esc → panel tertutup, fokus kembali ke tempat semula.
    await manual.keyboard.press('Escape');
    assert.equal(await manual.locator('#naravisi-host').count(), 0);
    assert.equal(await manual.evaluate(() => document.activeElement?.id), 'page-link');
    await manual.close();
    // Bersihkan agar hitungan kuota & riwayat skenario berikutnya tidak bergeser.
    await backend.db.run('DELETE FROM riwayat_deskripsi WHERE riwayat_id > ?', [before.last]);
    await backend.db.run('UPDATE kuota_harian SET jumlah_permintaan = 0');
  });

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

  await step('panel memakai token v2 & Atkinson Hyperlegible tanpa web_accessible_resources', async () => {
    const look = await page.evaluate(async () => {
      await document.fonts.ready;
      const panel = document.querySelector('#naravisi-host').shadowRoot.querySelector('.panel');
      const s = getComputedStyle(panel);
      return { bg: s.backgroundColor, color: s.color, font: s.fontFamily };
    });
    assert.deepEqual([look.bg, look.color], ['rgb(247, 243, 234)', 'rgb(20, 33, 61)']);
    assert.match(look.font, /^"NaraVisi Atkinson"/);
    await page.waitForFunction(() => [...document.fonts].some((f) => f.family.includes('NaraVisi Atkinson') && f.status === 'loaded'));
    const manifest = JSON.parse(readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.web_accessible_resources, undefined);
  });

  await step('UC-GBR-04..07: Enter → deskripsi tampil, dibacakan, sisa kuota diumumkan', async () => {
    await page.keyboard.press('Enter');
    await text.filter({ hasText: 'gambar PNG' }).waitFor({ timeout: 10000 });
    await status.filter({ hasText: 'Sisa kuota hari ini: 9.' }).waitFor();
    assert.equal(await host.getAttribute('data-last-spoken'), 'Deskripsi uji untuk gambar PNG.');
    // Tahap 1: jenis gambar tampil di panel; petunjuk halaman ikut dikirim ke AI.
    assert.equal(await page.locator('#nv-kind').textContent(), ' · Foto');
    assert.equal(await host.getAttribute('data-jenis'), 'foto');
    assert.ok(backend.ai.lastContext?.page_title, 'judul halaman dikirim sebagai petunjuk');
  });
  await page.screenshot({ path: path.join(uiDir, '07-panel-halaman.png') });

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

  await step('SVG (<img>) diubah ke JPEG oleh extension lalu dideskripsikan', async () => {
    await page.keyboard.press('ArrowDown');
    assert.match(await page.locator('#nv-list [role="option"]').nth(3).innerText(), /Gambar vektor/);
    await page.keyboard.press('Enter');
    await status.filter({ hasText: 'Sisa kuota hari ini: 7.' }).waitFor({ timeout: 10000 });
    assert.equal(await text.innerText(), 'Deskripsi uji untuk gambar JPEG.');
  });

  await step('gambar data: URL dideskripsikan; tersimpan di riwayat tanpa URL gambar', async () => {
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await status.filter({ hasText: 'Sisa kuota hari ini: 6.' }).waitFor({ timeout: 10000 });
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

  await step('UC-RWY-02: 4 riwayat tampil + info batas 7 hari untuk Gratis + jenis gambar', async () => {
    await hist.locator('.item').first().waitFor();
    assert.equal(await hist.locator('.item').count(), 4);
    assert.match(await hist.locator('.notice').innerText(), /7 hari terakhir/);
    assert.equal(await hist.locator('.item .jenis').first().innerText(), 'Jenis gambar: Foto');
  });

  await step('RF-15: detail riwayat — jenis gambar, sumber, putar ulang, kembali ke daftar', async () => {
    await hist.getByRole('link', { name: 'Detail', exact: true }).first().click();
    await hist.waitForURL(/riwayat\.html\?id=\d+$/);
    await hist.locator('#detail-jenis', { hasText: 'Foto' }).waitFor();
    assert.equal(await hist.locator('h1').innerText(), 'Detail riwayat');
    assert.equal(await hist.evaluate(() => document.activeElement.textContent), 'Putar ulang'); // fokus langsung di tombol putar ulang
    await hist.keyboard.press('Enter');
    assert.equal(await hist.locator('body').getAttribute('data-last-spoken'), await hist.locator('#detail-text').innerText());
    assert.deepEqual(await a11yAudit(hist), []);
    await hist.getByRole('link', { name: 'Kembali ke daftar riwayat' }).click();
    await hist.locator('.item').first().waitFor();
    const missing = await context.newPage();
    await missing.goto(extPage('pages/riwayat.html?id=999999'));
    await missing.locator('#content', { hasText: 'Riwayat tidak ditemukan' }).waitFor();
    await missing.close();
  });

  await step('UC-RWY-03: putar ulang deskripsi', async () => {
    await hist.getByRole('button', { name: 'Putar ulang' }).first().click();
    assert.match(await hist.locator('body').getAttribute('data-last-spoken'), /Deskripsi uji/);
  });

  await step('UC-RWY-04: hapus riwayat (dengan konfirmasi)', async () => {
    await hist.getByRole('button', { name: 'Hapus', exact: true }).first().click();
    await hist.locator('#msg', { hasText: 'Riwayat berhasil dihapus.' }).waitFor();
    await hist.locator('.item').nth(3).waitFor({ state: 'detached' }); // pesan tampil sebelum daftar dimuat ulang
    assert.equal(await hist.locator('.item').count(), 3);
  });

  await step('RF-16: hapus SEMUA riwayat (dengan konfirmasi) — hanya milik sendiri', async () => {
    const saved = await sw.evaluate(() => chrome.storage.local.get(['nvSession', 'nvTts']));
    const tmp = await backend.register({ nama: 'Riwayat Sementara', email: 'riwayat-sementara@uji.id' });
    await backend.describe(tmp.token);
    await backend.describe(tmp.token);
    const othersBefore = await backend.db.get('SELECT COUNT(*) AS n FROM riwayat_deskripsi WHERE user_id <> ?', [tmp.user.user_id]);
    const page2 = await context.newPage();
    try {
      await sw.evaluate((x) => chrome.storage.local.set({ nvSession: { token: x.token, user: x.user, savedAt: Date.now() } }), tmp);
      await page2.goto(extPage('pages/riwayat.html'));
      await page2.locator('.item').nth(1).waitFor();
      await page2.getByRole('button', { name: 'Hapus semua riwayat' }).click(); // dialog konfirmasi diterima otomatis
      await page2.locator('#msg', { hasText: 'Semua riwayat dihapus (2 deskripsi).' }).waitFor();
      await page2.locator('#content', { hasText: 'Riwayat masih kosong' }).waitFor();
      const othersAfter = await backend.db.get('SELECT COUNT(*) AS n FROM riwayat_deskripsi WHERE user_id <> ?', [tmp.user.user_id]);
      assert.equal(Number(othersAfter.n), Number(othersBefore.n));
    } finally {
      await page2.close();
      await sw.evaluate((x) => chrome.storage.local.set(x), saved);
    }
  });

  await step('halaman riwayat lolos audit aksesibilitas', async () => assert.deepEqual(await a11yAudit(hist), []));
  await hist.screenshot({ path: path.join(shotsDir, '03-riwayat.png'), fullPage: true });
  await hist.screenshot({ path: path.join(uiDir, '08-riwayat.png'), fullPage: true });

  await step('zoom 200% (lebar efektif 550 px): riwayat tidak menggulir ke samping', async () => {
    await hist.setViewportSize({ width: 550, height: 820 });
    assert.ok(await hist.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    await hist.setViewportSize({ width: 1100, height: 820 });
  });
  await hist.close();

  // =========================================================================
  section('SVG inline & gambar latar CSS');
  const vec = await context.newPage();
  watch(vec);
  await vec.goto(`${SITE}/infografik.html`);
  const vecStatus = vec.locator('#nv-status');
  const vecText = vec.locator('#nv-text');
  const pixelAt = async (x, y) => {
    const { data, info } = await sharp(Buffer.from(backend.ai.lastImage, 'base64')).raw().toBuffer({ resolveWithObject: true });
    const i = (Math.round(y * (info.height - 1)) * info.width + Math.round(x * (info.width - 1))) * info.channels;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const near = (rgb, hex) => {
    const want = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return rgb.every((v, i) => Math.abs(v - want[i]) < 40);
  };

  await step('4 gambar ditemukan dalam urutan DOM: 2 SVG inline, latar foto, latar SVG (ikon dekoratif, sprite & gradien diabaikan)', async () => {
    const res = await toggleOn(`${SITE}/infografik.html`);
    assert.equal(res.count, 4);
    const items = await vec.locator('#nv-list [role="option"]').allInnerTexts();
    assert.match(items[0], /Gambar 1 dari 4\s+Gambar vektor · teks alternatif: “Grafik penjualan”/);
    assert.match(items[1], /Gambar vektor · teks alternatif: “Peta lokasi”/);
    assert.match(items[2], /Gambar latar · teks alternatif: “Pemandangan pantai”/);
    assert.match(items[3], /Gambar latar · nama file: grafik/);
    assert.equal(await vec.locator('[data-naravisi-mark]').count(), 4);
  });

  await step('SVG inline dikirim sebagai JPEG dengan warna dari CSS halaman', async () => {
    await vec.keyboard.press('Enter');
    await vecStatus.filter({ hasText: 'Deskripsi gambar 1 siap.' }).waitFor({ timeout: 10000 });
    assert.equal(await vecText.innerText(), 'Deskripsi uji untuk gambar JPEG.');
    assert.ok(near(await pixelAt(0.5, 0.5), '#e03030'), `warna ${await pixelAt(0.5, 0.5)}`);
    // <title> SVG sudah bermakna → tidak ditimpa
    assert.equal(await vec.locator('#grafik').getAttribute('data-naravisi'), null);
  });

  await step('SVG inline dengan <use> ke sprite di luar elemennya tetap tergambar', async () => {
    await vec.keyboard.press('ArrowDown');
    await vec.keyboard.press('Enter');
    await vecStatus.filter({ hasText: 'Deskripsi gambar 2 siap.' }).waitFor({ timeout: 10000 });
    assert.ok(near(await pixelAt(0.5, 0.5), '#20a040'), `warna ${await pixelAt(0.5, 0.5)}`);
  });

  await step('gambar latar foto dideskripsikan', async () => {
    await vec.keyboard.press('ArrowDown');
    await vec.keyboard.press('Enter');
    await vecStatus.filter({ hasText: 'Deskripsi gambar 3 siap.' }).waitFor({ timeout: 10000 });
    assert.ok(near(await pixelAt(0.5, 0.5), '#20a0c0'));
    const last = await backend.db.get('SELECT url_gambar FROM riwayat_deskripsi ORDER BY riwayat_id DESC LIMIT 1');
    assert.equal(last.url_gambar, `${SITE}/img/pantai.jpg`);
  });

  await step('gambar latar SVG diubah ke JPEG & dideskripsikan', async () => {
    await vec.keyboard.press('ArrowDown');
    await vec.keyboard.press('Enter');
    await vecStatus.filter({ hasText: 'Deskripsi gambar 4 siap.' }).waitFor({ timeout: 10000 });
    assert.ok(near(await pixelAt(0.5, 0.5), '#ffa500')); // lingkaran oranye
  });

  await step('panel di halaman infografik lolos audit aksesibilitas', async () => {
    assert.deepEqual(await a11yAudit(vec, '#naravisi-host'), []);
  });
  await vec.close();

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
    assert.equal(await set.locator('#kecepatan').getAttribute('aria-valuetext'), '1,5 kali'); // dibacakan NVDA
  });

  await step('RF-18: bahasa English disimpan → deskripsi berikutnya diminta dalam bahasa Inggris', async () => {
    await set.getByLabel('Bahasa deskripsi').selectOption('en');
    await set.getByRole('button', { name: 'Simpan pengaturan' }).click();
    await set.locator('#msg', { hasText: 'Pengaturan berhasil disimpan.' }).waitFor();
    assert.equal(await sw.evaluate(async () => (await chrome.storage.local.get('nvTts')).nvTts.bahasa_deskripsi), 'en');
    const lastId = (await backend.db.get('SELECT MAX(riwayat_id) AS id FROM riwayat_deskripsi')).id ?? 0;
    const tab = await context.newPage();
    const url = `${SITE}/`; // halaman berita yang sama, URL unik → toggleOn memilih tab ini
    try {
      await tab.goto(url);
      await toggleOn(url);
      await tab.locator('#nv-status', { hasText: 'gambar ditemukan' }).waitFor();
      await tab.keyboard.press('Enter');
      await tab.locator('#nv-text').filter({ hasText: 'Deskripsi uji' }).waitFor({ timeout: 10000 });
      assert.equal(backend.ai.lastLang, 'en');
    } finally {
      await tab.close();
      await backend.db.run('DELETE FROM riwayat_deskripsi WHERE riwayat_id > ?', [lastId]);
      await backend.db.run('UPDATE kuota_harian SET jumlah_permintaan = jumlah_permintaan - 1 WHERE jumlah_permintaan > 0');
      await set.bringToFront();
      await set.reload();
      await set.getByLabel('Bahasa deskripsi').selectOption('id');
      await set.getByRole('button', { name: 'Simpan pengaturan' }).click();
      await set.locator('#msg', { hasText: 'Pengaturan berhasil disimpan.' }).waitFor();
    }
  });

  await step('tombol "Coba suara" membacakan contoh', async () => {
    await set.getByRole('button', { name: 'Coba suara' }).click();
    assert.match(await set.locator('body').getAttribute('data-last-spoken'), /contoh suara NaraVisi/);
  });

  await step('alamat API & status server ada di Pengaturan', async () => {
    assert.equal(await set.getByLabel('Alamat API').inputValue(), API);
    await set.locator('#server-text', { hasText: /^Server terhubung/ }).waitFor();
    await set.getByLabel('Alamat API').fill('localhost:3000');
    await set.getByRole('button', { name: 'Simpan alamat' }).click();
    await set.locator('#msg', { hasText: 'harus diawali http://' }).waitFor();
    assert.equal(await set.getByLabel('Alamat API').getAttribute('aria-invalid'), 'true');
    await set.getByLabel('Alamat API').fill(`${API}/`);
    await set.getByRole('button', { name: 'Simpan alamat' }).click();
    await set.locator('#msg', { hasText: 'Alamat API disimpan.' }).waitFor();
    assert.equal(await sw.evaluate(async () => (await chrome.storage.sync.get('apiBase')).apiBase), API);
  });

  await step('zoom 200% (lebar efektif 550 px): pengaturan tidak menggulir ke samping', async () => {
    await set.setViewportSize({ width: 550, height: 820 });
    assert.ok(await set.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    await set.setViewportSize({ width: 1100, height: 820 });
  });

  await step('halaman pengaturan lolos audit aksesibilitas', async () => assert.deepEqual(await a11yAudit(set), []));
  await set.screenshot({ path: path.join(shotsDir, '04-pengaturan.png'), fullPage: true });

  // =========================================================================
  section('Daftar gambar & mode otomatis');
  const userId = (await backend.db.get('SELECT user_id FROM users WHERE email = ?', ['rifat@uji.id'])).user_id;
  const setUsed = (n) => backend.db.run('UPDATE kuota_harian SET jumlah_permintaan = ? WHERE user_id = ? AND tanggal = ?', [n, userId, backend.services.subscriptions.today()]);
  const autoLog = () => sw.evaluate(() => globalThis.naraVisi.autoLog);
  /** Buka URL di tab aktif lalu tunggu keputusan mode otomatis untuk URL itu. */
  async function visitAndWaitAuto(tab, url) {
    const since = Date.now();
    await tab.bringToFront();
    await tab.goto(url);
    for (let i = 0; i < 150; i++) {
      const hit = (await autoLog()).filter((e) => e.url === url && e.at >= since).at(-1);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`mode otomatis tidak memutuskan apa pun untuk ${url}`);
  }
  const alts = (tab) => tab.evaluate(() => Object.fromEntries([...document.querySelectorAll('img[id]')].map((i) => [i.id, i.getAttribute('alt')])));
  const autoTab = await context.newPage();
  watch(autoTab);

  await step('filter: ikon 50×50, alt="", logo situs dibuang; <main> dulu (tetap urutan DOM); label "Gambar n dari N · keterangan"', async () => {
    await setUsed(0);
    await autoTab.goto(`${SITE}/artikel.html`);
    const res = await toggleOn(`${SITE}/artikel.html`);
    assert.equal(res.count, 6);
    const options = autoTab.locator('#nv-list [role="option"]');
    const labels = await options.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    assert.equal(labels[0], 'Gambar 1 dari 6 · Banjir di Samarinda'); // figcaption
    assert.equal(labels[1], 'Gambar 2 dari 6 · tanpa keterangan'); // foto-1.jpg: nama file tidak bermakna
    assert.equal(labels[2], 'Gambar 3 dari 6 · teks alternatif: “Peta jalur evakuasi”');
    assert.equal(labels[5], 'Gambar 6 dari 6 · nama file: samping'); // di luar <main> → terakhir walau lebih dulu di DOM
    const all = labels.join('\n');
    assert.doesNotMatch(all, /ikon|logo|dekor/);
    assert.equal(await autoTab.locator('#nv-list .thumb[aria-hidden="true"]').count(), 6);
    assert.deepEqual(await a11yAudit(autoTab, '#naravisi-host'), []);
    await autoTab.screenshot({ path: path.join(uiDir, '11-panel-daftar-gambar.png') });
    await autoTab.keyboard.press('Escape');
  });

  // --- Tahap 2: urutan baca & terhubung ke pembaca layar ---------------------
  /** Nama aksesibel menurut pohon aksesibilitas Chrome (yang dibaca NVDA/JAWS), lewat CDP. */
  async function axNames(tab) {
    const cdp = await context.newCDPSession(tab);
    try {
      const { nodes } = await cdp.send('Accessibility.getFullAXTree');
      return nodes.filter((n) => n.role?.value === 'image' && !n.ignored).map((n) => n.name?.value ?? '');
    } finally {
      await cdp.detach();
    }
  }
  const optionLabels = (tab) => tab.locator('#nv-list [role="option"]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));

  await step('urutan baca = urutan DOM (bukan ukuran, bukan posisi absolut)', async () => {
    await autoTab.goto(`${SITE}/urutan-dom.html`);
    await toggleOn(`${SITE}/urutan-dom.html`);
    assert.deepEqual(await optionLabels(autoTab), [
      'Gambar 1 dari 3 · nama file: kucing', 'Gambar 2 dari 3 · nama file: anjing', 'Gambar 3 dari 3 · nama file: burung',
    ]);
    await autoTab.keyboard.press('Escape');
  });

  await step('layout grid dengan order CSS → urutan visual (atas→bawah, kiri→kanan)', async () => {
    await autoTab.goto(`${SITE}/urutan-grid.html`);
    await toggleOn(`${SITE}/urutan-grid.html`);
    assert.deepEqual(await optionLabels(autoTab), [
      'Gambar 1 dari 3 · nama file: anjing', 'Gambar 2 dari 3 · nama file: burung', 'Gambar 3 dari 3 · nama file: kucing',
    ]);
    await autoTab.keyboard.press('Escape');
  });

  await step('setelah dideskripsikan: alt asli bermakna tidak ditimpa, alt generik digabung, tanpa alt diisi; terbaca di pohon aksesibilitas', async () => {
    await setUsed(0);
    await autoTab.goto(`${SITE}/alt.html`);
    await toggleOn(`${SITE}/alt.html`);
    const st = autoTab.locator('#nv-status');
    for (let i = 1; i <= 4; i++) {
      if (i > 1) await autoTab.keyboard.press('ArrowDown');
      await autoTab.keyboard.press('Enter');
      await st.filter({ hasText: `Deskripsi gambar ${i} siap.` }).waitFor({ timeout: 10000 });
    }
    await autoTab.keyboard.press('Escape');
    const a = await alts(autoTab);
    const d = 'Deskripsi uji untuk gambar JPEG.';
    assert.equal(a.g1, `image. Deskripsi NaraVisi: ${d}`);
    assert.equal(a.g2, `IMG_2041.jpg. Deskripsi NaraVisi: ${d}`);
    assert.equal(a.g3, 'Petugas membagikan masker di pasar');
    assert.equal(a.g4, d);
    const marks = await autoTab.evaluate(() => Object.fromEntries([...document.images].map((i) => [i.id, i.getAttribute('data-naravisi')])));
    assert.deepEqual(marks, { g1: '1', g2: '1', g3: null, g4: '1' });
    // Inilah yang dibaca NVDA saat menekan G (gambar berikutnya), berurutan sesuai posisi gambar.
    assert.deepEqual(await axNames(autoTab), [`image. Deskripsi NaraVisi: ${d}`, `IMG_2041.jpg. Deskripsi NaraVisi: ${d}`, 'Petugas membagikan masker di pasar', d]);
  });

  await step('mode otomatis mati (bawaan) → tidak ada permintaan ke server', async () => {
    const before = backend.ai.calls;
    const hit = await visitAndWaitAuto(autoTab, `${SITE}/artikel-2.html`);
    assert.equal(hit.result, 'off');
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(backend.ai.calls, before);
    assert.equal(await autoTab.locator('[data-naravisi]').count(), 0);
  });

  await step('Pengaturan "Baca berurutan": persetujuan dibacakan; Batal → tetap mati, Ya → aktif; jumlah 1–10', async () => {
    await set.bringToFront();
    await set.reload();
    const toggle = set.getByLabel('Baca berurutan: deskripsikan otomatis gambar tanpa teks alternatif');
    await toggle.waitFor();
    assert.equal(await toggle.isChecked(), false);
    assert.equal(await set.getByLabel('Umumkan jumlah gambar saat halaman dibuka').count(), 1);
    assert.equal(await set.getByLabel('Sapaan saat Chrome dibuka').isChecked(), true);
    const jumlah = set.getByLabel('Jumlah gambar per halaman (baca berurutan)');
    assert.equal(await jumlah.inputValue(), '3');
    assert.deepEqual(await jumlah.locator('option').evaluateAll((o) => o.map((x) => x.value)), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
    assert.match(await set.getByLabel('Situs yang tidak pernah diproses otomatis (satu per baris)').inputValue(), /^klikbca\.com\n.*web\.whatsapp\.com$/s);
    await set.locator('#otomatis-section').screenshot({ path: path.join(uiDir, '09-pengaturan-otomatis.png') });

    await toggle.click(); // centang baru berlaku setelah disetujui
    const dialog = set.getByRole('dialog', { name: 'Kirim gambar ke server?' });
    await dialog.waitFor();
    assert.match(await dialog.innerText(), /akan dikirim ke server NaraVisi untuk dideskripsikan dan memakai kuota harian\. Server meneruskannya ke Google Gemini\. Lanjutkan\?/);
    assert.equal(await set.evaluate(() => document.activeElement.textContent), 'Batal');
    assert.match((await spoken()).at(-1), /^Gambar dari halaman yang Anda buka akan dikirim ke server NaraVisi/);
    await set.screenshot({ path: path.join(uiDir, '10-persetujuan-otomatis.png') });
    await dialog.getByRole('button', { name: 'Batal' }).click();
    assert.equal(await toggle.isChecked(), false);
    assert.equal(await sw.evaluate(async () => (await chrome.storage.sync.get('autoDescribe')).autoDescribe ?? false), false);

    await toggle.click();
    await dialog.getByRole('button', { name: 'Ya, aktifkan' }).click();
    await set.locator('#msg', { hasText: 'Baca berurutan diaktifkan.' }).waitFor();
    assert.equal(await toggle.isChecked(), true);
    assert.equal(await sw.evaluate(async () => (await chrome.storage.sync.get('autoDescribe')).autoDescribe), true);
    assert.deepEqual(await a11yAudit(set), []);
  });

  await step('mode otomatis hidup → maks. 3 permintaan berurutan, alt terisi, alt asli tidak ditimpa', async () => {
    await setUsed(0);
    const before = backend.ai.calls;
    const url = `${SITE}/artikel.html`;
    const hit = await visitAndWaitAuto(autoTab, url);
    assert.equal(hit.result, 'done');
    assert.equal(hit.described, 3);
    assert.equal(backend.ai.calls - before, 3);
    const a = await alts(autoTab);
    for (const id of ['banjir', 'foto1', 'foto2']) assert.equal(a[id], 'Deskripsi uji untuk gambar JPEG.', id);
    assert.equal(a.peta, 'Peta jalur evakuasi'); // alt bermakna tidak ditimpa
    assert.equal(a.foto3, null); // di luar batas 3
    assert.equal(a.samping, null);
    assert.equal(a.dekor, ''); // dekoratif tidak disentuh
    assert.equal(await autoTab.locator('[data-naravisi="1"]').count(), 3);
    // Hanya alt & data-naravisi + satu live region tersembunyi yang disuntik; tidak ada panel, tidak ada token di DOM.
    assert.equal(await autoTab.locator('#naravisi-host').count(), 0);
    assert.equal(await autoTab.locator('#naravisi-live').count(), 1);
    const html = await autoTab.content();
    const token = await sw.evaluate(async () => (await chrome.storage.local.get('nvSession')).nvSession.token);
    assert.ok(!html.includes(token));
    assert.equal(hit.summary, '3 gambar sudah dideskripsikan. Sisa kuota hari ini 7.');
    // Progres diumumkan lewat aria-live (sopan, tidak menyela NVDA), bukan suara chrome.tts.
    assert.equal(await autoTab.locator('#naravisi-live').getAttribute('data-last'), 'Gambar 3 dari 3 sudah dideskripsikan.');
    assert.notEqual((await spoken()).at(-1), hit.summary);
  });

  await step('rute SPA / pemicu ulang di dokumen yang sama → tidak memproses ulang', async () => {
    const before = backend.ai.calls;
    const res = await sw.evaluate(async (u) => {
      const [tab] = await chrome.tabs.query({ url: u });
      return globalThis.naraVisi.autoDescribePage(tab.id);
    }, `${SITE}/artikel.html`);
    assert.equal(res.described, 0);
    assert.equal(backend.ai.calls, before);
  });

  await step('panel memakai cache hasil otomatis (tanpa permintaan baru)', async () => {
    const before = backend.ai.calls;
    await toggleOn(`${SITE}/artikel.html`);
    await autoTab.keyboard.press('Enter');
    await autoTab.locator('#nv-status', { hasText: 'Deskripsi gambar 1.' }).waitFor();
    assert.equal(backend.ai.calls, before);
    await autoTab.keyboard.press('Escape');
  });

  await step('baca berurutan: maks. N gambar, SATU PER SATU, yang terlihat dulu, lanjut saat digulir; progres via aria-live', async () => {
    await setUsed(0);
    await sw.evaluate(() => chrome.storage.sync.set({ autoMax: 3 }));
    backend.ai.delayMs = 150; // agar permintaan paralel (bila ada) pasti tumpang tindih
    backend.ai.maxInFlight = 0;
    const before = backend.ai.calls;
    const lastId = (await backend.db.get('SELECT MAX(riwayat_id) AS id FROM riwayat_deskripsi')).id ?? 0;
    const hit = await visitAndWaitAuto(autoTab, `${SITE}/panjang.html`);
    assert.equal(hit.result, 'done');
    assert.equal(hit.described, 2); // p3, p4 jauh di bawah layar → belum diproses
    assert.equal(backend.ai.calls - before, 2);
    const live = autoTab.locator('#naravisi-live');
    assert.equal(await live.getAttribute('data-last'), 'Gambar 2 dari 3 sudah dideskripsikan.');
    // Pengguna menggulir/membaca ke bawah → gambar berikutnya diproses, berhenti di N = 3.
    await autoTab.evaluate(() => document.getElementById('p3').scrollIntoView());
    await autoTab.waitForFunction(() => document.getElementById('p3').getAttribute('data-naravisi') === '1', null, { timeout: 10000 });
    await autoTab.waitForFunction(() => document.getElementById('naravisi-live').dataset.last === 'Gambar 3 dari 3 sudah dideskripsikan.');
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(backend.ai.calls - before, 3);
    assert.equal(await autoTab.locator('#p4').getAttribute('data-naravisi'), null);
    assert.equal(backend.ai.maxInFlight, 1, 'tidak pernah paralel');
    const order = await backend.db.all('SELECT url_gambar FROM riwayat_deskripsi WHERE riwayat_id > ? ORDER BY riwayat_id', [lastId]);
    assert.deepEqual(order.map((r) => r.url_gambar.split('/').pop()), ['p1.jpg', 'p2.jpg', 'p3.jpg']);
    // Live region sopan (polite), tersembunyi visual, di luar panel; tidak ada suara chrome.tts yang menyela.
    assert.equal(await live.evaluate((h) => h.shadowRoot.querySelector('[role="status"]').getAttribute('aria-live')), 'polite');
    assert.ok(!(await spoken()).some((t) => /sudah dideskripsikan/.test(t)));
    backend.ai.delayMs = 0;
  });

  await step('domain dikecualikan (diedit di Pengaturan) → tidak ada permintaan', async () => {
    await set.bringToFront();
    const sites = set.getByLabel('Situs yang tidak pernah diproses otomatis (satu per baris)');
    await sites.fill(`${await sites.inputValue()}\nhttp://127.0.0.1/jalur`);
    await set.getByRole('button', { name: 'Simpan daftar situs' }).click();
    await set.locator('#msg', { hasText: '11 situs dikecualikan' }).waitFor();
    assert.match(await sites.inputValue(), /\n127\.0\.0\.1$/);
    const before = backend.ai.calls;
    const hit = await visitAndWaitAuto(autoTab, `${SITE}/artikel-2.html`);
    assert.equal(hit.result, 'excluded');
    assert.equal(backend.ai.calls, before);
    assert.ok(await sw.evaluate(() => globalThis.naraVisi.isExcluded('https://ib.bri.co.id/masuk', ['bri.co.id'])));
    assert.ok(await sw.evaluate(() => globalThis.naraVisi.isExcluded('https://app.gopay.co.id/', ['gopay'])));
    assert.ok(!(await sw.evaluate(() => globalThis.naraVisi.isExcluded('https://abri.co.id/', ['bri.co.id']))));
    await set.bringToFront();
    await set.getByRole('button', { name: 'Kembalikan daftar bawaan' }).click();
    await set.locator('#msg', { hasText: 'Daftar situs bawaan dikembalikan.' }).waitFor();
  });

  await step('halaman dengan <input type="password"> → mode otomatis tidak jalan', async () => {
    const before = backend.ai.calls;
    const hit = await visitAndWaitAuto(autoTab, `${SITE}/masuk.html`);
    assert.equal(hit.result, 'password');
    assert.equal(backend.ai.calls, before);
    assert.equal(await autoTab.locator('[data-naravisi]').count(), 0);
  });

  await step('kuota tersisa 2 → tidak jalan & alasan dibacakan', async () => {
    await setUsed(8);
    const before = backend.ai.calls;
    const hit = await visitAndWaitAuto(autoTab, `${SITE}/artikel-3.html`);
    assert.equal(hit.result, 'quota');
    assert.equal(backend.ai.calls, before);
    assert.equal(await autoTab.locator('#naravisi-live').getAttribute('data-last'), 'Baca berurutan berhenti: sisa kuota hari ini 2, disisakan untuk pilihan Anda.');
  });

  await step('kuota tersisa 4 → berhenti setelah 2 gambar (sisa 2) & alasan dibacakan', async () => {
    await setUsed(6);
    const before = backend.ai.calls;
    const hit = await visitAndWaitAuto(autoTab, `${SITE}/artikel.html`);
    assert.equal(backend.ai.calls - before, 2);
    assert.equal(hit.described, 2);
    assert.equal(hit.stopped, 'quota');
    assert.equal(hit.summary, '2 gambar sudah dideskripsikan. Sisa kuota hari ini 2. Baca berurutan berhenti agar 2 kuota tersisa untuk pilihan Anda.');
    await autoTab.waitForFunction(() => document.getElementById('naravisi-live')?.dataset.last === 'Baca berurutan berhenti: sisa kuota hari ini 2, disisakan untuk pilihan Anda.');
  });

  await step('fokus keyboard pada tautan bergambar tanpa alt → dideskripsikan & dibacakan', async () => {
    await sw.evaluate(() => chrome.storage.sync.set({ autoDescribe: false }));
    await set.bringToFront();
    await set.reload();
    const fokus = set.getByLabel('Deskripsikan saat gambar mendapat fokus keyboard');
    await fokus.click();
    await set.getByRole('dialog').getByRole('button', { name: 'Ya, aktifkan' }).click();
    await set.locator('#msg', { hasText: 'Deskripsi saat fokus diaktifkan.' }).waitFor();
    await setUsed(0);
    const before = backend.ai.calls;
    await autoTab.bringToFront();
    await autoTab.goto(`${SITE}/tautan.html`);
    await new Promise((r) => setTimeout(r, 2500)); // pendengar fokus dipasang ±1,5 detik setelah halaman selesai dimuat
    await autoTab.focus('#awal');
    await autoTab.keyboard.press('Tab');
    assert.equal(await autoTab.evaluate(() => document.activeElement.id), 'tautan-gambar');
    await autoTab.locator('#tautan-gambar img[data-naravisi="1"]').waitFor({ state: 'attached', timeout: 10000 });
    assert.equal(backend.ai.calls - before, 1);
    assert.equal(await autoTab.locator('#tautan-gambar img').getAttribute('alt'), 'Deskripsi uji untuk gambar JPEG.');
    assert.equal((await spoken()).at(-1), 'Deskripsi NaraVisi: Deskripsi uji untuk gambar JPEG.');
    await sw.evaluate(() => chrome.storage.sync.set({ describeOnFocus: false }));
  });
  await autoTab.close();

  await step('Chrome dibuka: sapaan sisa kuota; pintasan belum diatur → dibacakan & Pengaturan dibuka', async () => {
    const shortcut = await sw.evaluate(async () => (await chrome.commands.getAll()).find((c) => c.name === 'scan-page')?.shortcut || '');
    if (shortcut) {
      assert.equal(await sw.evaluate(() => globalThis.naraVisi.startupGreeting()), 'greeted');
      assert.equal((await spoken()).at(-1), 'NaraVisi aktif. Sisa kuota hari ini 9.');
      return;
    }
    const [tab, result] = await Promise.all([
      context.waitForEvent('page', { predicate: (p) => p.url().includes('pengaturan.html#pintasan') }),
      sw.evaluate(() => globalThis.naraVisi.startupGreeting()),
    ]);
    assert.equal(result, 'no-shortcut');
    assert.equal((await spoken()).at(-1), 'NaraVisi aktif. Sisa kuota hari ini 9. Pintasan NaraVisi belum diatur. Halaman pengaturan dibuka.');
    await tab.waitForFunction(() => document.activeElement?.id === 'open-shortcuts');
    await tab.locator('#msg', { hasText: 'Pintasan NaraVisi belum diatur' }).waitFor();
    await tab.close();
  });

  await step('sapaan saat Chrome dibuka bisa dimatikan', async () => {
    await sw.evaluate(() => chrome.storage.sync.set({ greetOnStartup: false }));
    assert.equal(await sw.evaluate(() => globalThis.naraVisi.startupGreeting()), null);
    await sw.evaluate(() => chrome.storage.sync.set({ greetOnStartup: true }));
  });

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
  section('Profil (UC-AKUN-02..04)');
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
    await prof.getByLabel('Kata sandi saat ini').fill('sandiku123');
    await prof.getByLabel('Kata sandi baru').fill('123');
    await prof.getByRole('button', { name: 'Simpan perubahan' }).click();
    await prof.locator('#msg', { hasText: 'minimal 8 karakter' }).waitFor();
  });

  await step('RF-03: ubah email wajib kata sandi saat ini', async () => {
    const saved = await sw.evaluate(() => chrome.storage.local.get(['nvSession', 'nvTts']));
    const tmp = await backend.register({ nama: 'Akun Sementara', email: 'sementara@uji.id' });
    try {
      await sw.evaluate((s) => chrome.storage.local.set({ nvSession: { token: s.token, user: s.user, savedAt: Date.now() } }), tmp);
      await prof.reload();
      const email = prof.getByLabel('Email', { exact: true });
      await email.waitFor();
      await email.fill('pindah@uji.id');
      await prof.getByRole('button', { name: 'Simpan perubahan' }).click();
      await prof.locator('#msg', { hasText: 'Masukkan kata sandi saat ini' }).waitFor();
      assert.equal(await prof.evaluate(() => document.activeElement.id), 'e-lama');
      await prof.getByLabel('Kata sandi saat ini').fill(tmp.password);
      await prof.getByRole('button', { name: 'Simpan perubahan' }).click();
      await prof.locator('#msg', { hasText: 'Profil berhasil diperbarui.' }).waitFor();
      const row = await backend.db.get('SELECT email FROM users WHERE user_id = ?', [tmp.user.user_id]);
      assert.equal(row.email, 'pindah@uji.id');
    } finally {
      await sw.evaluate((s) => chrome.storage.local.set(s), saved);
    }
  });

  await step('RF-04: hapus akun permanen — wajib ketik "HAPUS"; riwayat ikut terhapus; token dicabut', async () => {
    const saved = await sw.evaluate(() => chrome.storage.local.get(['nvSession', 'nvTts']));
    const tmp = await backend.register({ nama: 'Akan Dihapus', email: 'dihapus@uji.id' });
    await backend.describe(tmp.token);
    try {
      await sw.evaluate((s) => chrome.storage.local.set({ nvSession: { token: s.token, user: s.user, savedAt: Date.now() } }), tmp);
      await prof.reload();
      const konfirmasi = prof.getByLabel('Ketik HAPUS untuk konfirmasi');
      await konfirmasi.waitFor();
      await konfirmasi.fill('hapus');
      await prof.locator('#d-sandi').fill(tmp.password);
      await prof.getByRole('button', { name: 'Hapus akun permanen' }).click();
      await prof.locator('#msg', { hasText: 'Akun tidak dihapus. Ketik HAPUS' }).waitFor();
      assert.equal(await prof.evaluate(() => document.activeElement.id), 'd-konfirmasi');
      assert.equal(await konfirmasi.getAttribute('aria-invalid'), 'true');
      assert.ok(await backend.db.get('SELECT 1 AS ada FROM users WHERE user_id = ?', [tmp.user.user_id]));

      await konfirmasi.fill('HAPUS');
      await prof.getByRole('button', { name: 'Hapus akun permanen' }).click();
      await prof.locator('#msg', { hasText: 'Akun berhasil dihapus.' }).waitFor();
      assert.equal(await backend.db.get('SELECT 1 AS ada FROM users WHERE user_id = ?', [tmp.user.user_id]), undefined);
      const left = await backend.db.get('SELECT COUNT(*) AS n FROM riwayat_deskripsi WHERE user_id = ?', [tmp.user.user_id]);
      assert.equal(Number(left.n), 0);
      assert.equal((await backend.api('GET', '/api/v1/me', { token: tmp.token })).status, 401);
      assert.equal(await sw.evaluate(async () => (await chrome.storage.local.get('nvSession')).nvSession ?? null), null);
    } finally {
      await sw.evaluate((s) => chrome.storage.local.set(s), saved);
    }
  });

  await step('halaman profil lolos audit aksesibilitas', async () => {
    await prof.reload();
    await prof.locator('#p-nama').waitFor();
    assert.deepEqual(await a11yAudit(prof), []);
  });
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

  await step('Alt+Shift+K saat belum masuk → dibacakan & tab masuk terbuka, fokus di Email', async () => {
    const [tab] = await Promise.all([
      context.waitForEvent('page'),
      sw.evaluate(() => globalThis.naraVisi.handleScanCommand()),
    ]);
    await tab.waitForURL(/selamat-datang\.html#masuk$/);
    await tab.waitForFunction(() => document.activeElement?.id === 'login-email');
    assert.equal((await spoken()).at(-1), 'Anda belum masuk. Halaman masuk dibuka.');
    await tab.close();
  });

  await step('Chrome dibuka dengan sesi kedaluwarsa → dibacakan & halaman masuk dibuka', async () => {
    await sw.evaluate(() => chrome.storage.local.set({ nvSession: { token: 'token-kedaluwarsa', user: null } }));
    const [tab, result] = await Promise.all([
      context.waitForEvent('page', { predicate: (p) => p.url().includes('selamat-datang.html#masuk') }),
      sw.evaluate(() => globalThis.naraVisi.startupGreeting()),
    ]);
    assert.equal(result, 'expired');
    assert.equal((await spoken()).at(-1), 'Sesi NaraVisi berakhir. Halaman masuk dibuka.');
    assert.equal(await sw.evaluate(async () => (await chrome.storage.local.get('nvSession')).nvSession ?? null), null);
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

  await step('service worker menolak pengirim asing & tipe pesan yang tidak dikenal/tidak diizinkan', async () => {
    const cases = await sw.evaluate(() => {
      const own = chrome.runtime.id;
      const page = { id: own, url: chrome.runtime.getURL('popup/popup.html') };
      const content = { id: own, url: 'https://contoh.id/berita', tab: { id: 1 } };
      const check = globalThis.naraVisi.rejectReason;
      return {
        asing: check({ type: 'NV_DESCRIBE' }, { id: 'extension-lain', url: 'https://contoh.id/' }),
        tanpaPengirim: check({ type: 'NV_HEALTH' }, undefined),
        tipeAsing: check({ type: 'NV_HAPUS_SEMUA' }, page),
        contentMintaSuara: check({ type: 'NV_SPEAK', text: 'x' }, content),
        contentDeskripsi: check({ type: 'NV_DESCRIBE' }, content),
        popupSuara: check({ type: 'NV_SPEAK', text: 'x' }, page),
      };
    });
    assert.deepEqual(cases, {
      asing: 'sender', tanpaPengirim: 'sender', tipeAsing: 'type',
      contentMintaSuara: 'type', contentDeskripsi: null, popupSuara: null,
    });
    // Jalur nyata dari halaman extension: tipe tidak dikenal dijawab MESSAGE_REJECTED.
    const opt = await context.newPage();
    await opt.goto(extPage('pages/selamat-datang.html'));
    const res = await opt.evaluate(() => chrome.runtime.sendMessage({ type: 'NV_HAPUS_SEMUA' }));
    assert.equal(res.code, 'MESSAGE_REJECTED');
    await opt.close();
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
