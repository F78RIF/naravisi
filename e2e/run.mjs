// Uji end-to-end extension NaraVisi di Chromium (Playwright).
// Server tiruan memakai logika backend asli (descriptionService + validasi gambar)
// dengan klien AI palsu, sehingga yang diuji: extension → API → respons → TTS.
//
// Jalankan: node e2e/run.mjs   (butuh playwright + sharp)

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
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
const { createDescriptionService } = await import('../backend/src/services/descriptionService.js');
const { AppError } = await import('../backend/src/lib/errors.js');

// ---------------------------------------------------------------------------
// Fixture gambar
// ---------------------------------------------------------------------------
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

const testPage = `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Halaman uji NaraVisi</title></head>
<body style="font-family:sans-serif;padding:20px">
  <h1>Berita Uji</h1>
  <a href="#" id="page-link">Tautan halaman</a>
  <p><img src="/img/wide.png" alt="" width="400" height="250"></p>
  <p><img src="/img/photo.jpg" alt="Foto produk sepatu" width="300" height="300"></p>
  <p><img src="/img/tiny.png" alt="ikon" width="16" height="16"> ikon kecil (harus diabaikan)</p>
  <p><img src="/img/hidden.png" style="display:none" alt="tersembunyi"></p>
  <p><img src="/img/modern.avif" width="320" height="200"></p>
  <p><img src="/img/logo.svg" alt="Logo" width="200" height="200"></p>
  <p><img src="${inlinePng}" width="120" height="120" alt="Gambar inline"></p>
  <p><img src="/img/photo.jpg" alt="duplikat" width="150" height="150"></p>
</body></html>`;

// ---------------------------------------------------------------------------
// Server tiruan: halaman uji + REST API
// ---------------------------------------------------------------------------
const apiCalls = [];
const fakeAi = {
  async caption({ lang }) {
    return { text: 'PLACEHOLDER', textEn: null, lang, model: 'fake', latencyMs: 1 };
  },
  async health() {
    return { ok: true, provider: 'fake', model: 'fake' };
  },
};
const descriptions = createDescriptionService({ aiClient: fakeAi, maxImageBytes: 5 * 1024 * 1024 });

const server = http.createServer(async (req, res) => {
  const send = (status, body, type = 'application/json') => {
    res.writeHead(status, { 'content-type': type, 'access-control-allow-origin': '*' });
    res.end(type === 'application/json' ? JSON.stringify(body) : body);
  };
  if (req.url === '/' || req.url === '/test.html') return send(200, testPage, 'text/html; charset=utf-8');
  if (fixtures[req.url]) return send(200, fixtures[req.url].body, fixtures[req.url].type);
  if (req.url === '/api/v1/health') return send(200, { status: 'ok', ai: await fakeAi.health() });
  if (req.url === '/api/v1/descriptions' && req.method === 'POST') {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    try {
      const body = JSON.parse(raw);
      const out = await descriptions.describe(body);
      out.text = `Deskripsi uji untuk ${out.image_mime}.`;
      apiCalls.push({ ...out, image_url: body.image_url });
      return send(201, out);
    } catch (err) {
      if (err instanceof AppError) return send(err.status, { error: { code: err.code, message: err.message } });
      return send(500, { error: { code: 'INTERNAL', message: String(err) } });
    }
  }
  return send(404, { error: { code: 'NOT_FOUND' } });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

// ---------------------------------------------------------------------------
// Chromium + extension
// ---------------------------------------------------------------------------
const context = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'nv-')), {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1100, height: 800 },
  args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
});

const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✔ ${name}`);
  } catch (err) {
    results.push({ name, ok: false, err });
    console.log(`  ✘ ${name}\n    ${err.message.split('\n').join('\n    ')}`);
  }
}

try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  // Tunggu sampai API chrome.* siap di service worker.
  for (let i = 0; i < 50 && !(await sw.evaluate(() => Boolean(globalThis.chrome?.storage && globalThis.naraVisi))); i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  await sw.evaluate((apiBase) => chrome.storage.sync.set({ apiBase }), `${origin}/api/v1`);

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e));
  await page.goto(`${origin}/test.html`);
  await page.waitForLoadState('load');
  await page.focus('#page-link');

  const toggle = () =>
    sw.evaluate(async (url) => {
      const [tab] = await chrome.tabs.query({ url });
      return globalThis.naraVisi.togglePanel(tab.id);
    }, `${origin}/test.html`);

  const host = page.locator('#naravisi-host');
  const status = page.locator('#nv-status');
  const text = page.locator('#nv-text');

  console.log('\nNaraVisi E2E');

  await step('UC-GBR-01: panel terbuka dan memindai 5 gambar (ikon kecil, tersembunyi, duplikat diabaikan)', async () => {
    const res = await toggle();
    assert.equal(res.ok, true);
    assert.equal(res.count, 5);
    await host.waitFor({ state: 'attached' });
    await page.waitForFunction(() =>
      document.querySelector('#naravisi-host')?.shadowRoot.querySelector('#nv-status')?.textContent.includes('5 gambar ditemukan'),
    );
  });

  await step('UC-GBR-01: gambar ditandai di halaman, gambar pertama aktif', async () => {
    assert.equal(await page.locator('[data-naravisi-mark]').count(), 5);
    assert.equal(await page.locator('[data-naravisi-mark="active"]').getAttribute('src'), '/img/wide.png');
  });

  await step('UC-GBR-02: daftar menyebut teks alternatif / ketiadaannya', async () => {
    const options = page.locator('#nv-list [role="option"]');
    assert.equal(await options.count(), 5);
    assert.match(await options.nth(0).innerText(), /Gambar 1 dari 5[\s\S]*Tanpa teks alternatif/);
    assert.match(await options.nth(1).innerText(), /Foto produk sepatu/);
  });

  await step('RNF-03: fokus keyboard berada di daftar gambar', async () => {
    const focusedId = await page.evaluate(
      () => document.querySelector('#naravisi-host').shadowRoot.activeElement?.id,
    );
    assert.equal(focusedId, 'nv-list');
  });

  await step('UC-GBR-04..07: Enter → deskripsi tampil dan dibacakan (PNG)', async () => {
    await page.keyboard.press('Enter');
    await text.filter({ hasText: 'image/png' }).waitFor({ timeout: 10000 });
    assert.equal(await host.getAttribute('data-last-spoken'), 'Deskripsi uji untuk image/png.');
    assert.equal(apiCalls.at(-1).page_url, `${origin}/test.html`);
    assert.equal(apiCalls.at(-1).image_url, `${origin}/img/wide.png`);
  });

  await step('UC-GBR-03: panah bawah memilih gambar berikutnya', async () => {
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator('[data-naravisi-mark="active"]').getAttribute('src'), '/img/photo.jpg');
    const selected = page.locator('#nv-list [aria-selected="true"]');
    assert.match(await selected.innerText(), /Gambar 2 dari 5/);
  });

  await step('AVIF dikonversi ke JPEG oleh extension sebelum dikirim', async () => {
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await text.filter({ hasText: 'image/jpeg' }).waitFor({ timeout: 10000 });
    assert.equal(apiCalls.at(-1).image_url, `${origin}/img/modern.avif`);
  });

  await step('SVG ditolak dengan pesan jelas (RNF-06)', async () => {
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await status.filter({ hasText: 'SVG' }).waitFor({ timeout: 10000 });
    assert.equal(await host.getAttribute('data-state'), 'error');
  });

  await step('Gambar data: URL berhasil dideskripsikan', async () => {
    const before = apiCalls.length;
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.locator('#naravisi-host[data-state="done"]').waitFor({ state: 'attached', timeout: 10000 });
    assert.equal(apiCalls.length, before + 1);
    assert.equal(apiCalls.at(-1).image_url, null);
  });

  await step('Hasil disimpan sementara: deskripsi ulang tidak memanggil API lagi', async () => {
    const before = apiCalls.length;
    await page.keyboard.press('Home');
    await page.keyboard.press('Enter');
    await text.filter({ hasText: 'image/png' }).waitFor();
    assert.equal(apiCalls.length, before);
  });

  await step('Kontrol suara: tombol Berhenti/Ulang ada dan dapat diklik', async () => {
    for (const name of ['Putar', 'Jeda', 'Ulang', 'Berhenti']) {
      assert.equal(await page.getByRole('button', { name, exact: true }).count(), 1, name);
    }
    await page.getByRole('button', { name: 'Ulang', exact: true }).click();
    assert.equal(await host.getAttribute('data-last-spoken'), 'Deskripsi uji untuk image/png.');
    await page.getByRole('button', { name: 'Berhenti', exact: true }).click();
    assert.equal(await host.getAttribute('data-tts'), 'idle');
  });

  await page.screenshot({ path: path.join(shotsDir, 'panel.png') });

  await step('Esc menutup panel, menghapus penanda, dan mengembalikan fokus', async () => {
    await page.locator('#nv-list').focus();
    await page.keyboard.press('Escape');
    assert.equal(await host.count(), 0);
    assert.equal(await page.locator('[data-naravisi-mark]').count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'page-link');
  });

  await step('Server mati → pesan error jelas dibacakan (RNF-12)', async () => {
    await sw.evaluate(() => chrome.storage.sync.set({ apiBase: 'http://127.0.0.1:9/api/v1' }));
    await toggle();
    await page.keyboard.press('ArrowDown'); // gambar 2 belum pernah dideskripsikan (tidak ada di cache)
    await page.keyboard.press('Enter');
    await status.filter({ hasText: 'Tidak dapat terhubung ke server' }).waitFor({ timeout: 15000 });
    assert.match(await host.getAttribute('data-last-spoken'), /Tidak dapat terhubung/);
    await toggle();
    assert.equal(await host.count(), 0);
  });

  await step('Halaman chrome:// → togglePanel mengembalikan pesan, tidak crash', async () => {
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

  await step('Halaman tanpa gambar → status "Tidak ada gambar"', async () => {
    await page.bringToFront();
    await page.goto(`${origin}/api/v1/health`); // halaman JSON tanpa gambar
    const res = await sw.evaluate(async (url) => {
      const [tab] = await chrome.tabs.query({ url });
      return globalThis.naraVisi.togglePanel(tab.id);
    }, `${origin}/api/v1/health`);
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.count, 0);
    await status.filter({ hasText: 'Tidak ada gambar' }).waitFor();
  });

  await step('Tidak ada error JavaScript di halaman', async () => {
    assert.deepEqual(pageErrors.map(String), []);
  });

  // Popup
  await step('Popup: status server tampil', async () => {
    const extId = new URL(sw.url()).host;
    await sw.evaluate((apiBase) => chrome.storage.sync.set({ apiBase }), `${origin}/api/v1`);
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 320, height: 420 });
    await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
    await popup.locator('details').evaluate((d) => (d.open = true));
    await popup.locator('#health[data-ok="true"]').waitFor({ timeout: 5000 });
    assert.equal(await popup.evaluate(() => document.activeElement?.id), 'scan');
    await popup.screenshot({ path: path.join(shotsDir, 'popup.png') });
    await popup.close();
  });
} finally {
  await context.close();
  server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} lulus`);
process.exit(failed.length ? 1 : 0);
