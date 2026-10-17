// Merekam video demo NaraVisi (Fase 7) dengan Playwright.
// Semua komponen asli kecuali model AI (teks tetap) — suara TTS tidak terekam,
// jadi teks yang dibacakan ditampilkan sebagai keterangan di layar.
//
// Jalankan: cd e2e && npm run demo   → demo/naravisi-demo.webm (+ .mp4 bila ffmpeg tersedia)

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
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
const outDir = path.resolve(here, 'demo');
const rawDir = path.join(outDir, 'raw');
rmSync(rawDir, { recursive: true, force: true });
mkdirSync(rawDir, { recursive: true });

const { startTestApp, ADMIN } = await import('../backend/test/support/testApp.js');

// --- Backend NaraVisi + model AI tiruan dengan deskripsi yang masuk akal untuk demo ---
const backend = await startTestApp();
backend.clock.set(new Date().toISOString());
backend.services.config.publicUrl = backend.base;
// Urutan sesuai gambar yang dideskripsikan di demo: gambar 1, gambar 3, lalu gambar 4.
const CAPTIONS = [
  'Seorang pria bersepeda di jalan kota yang ramai.',
  'Pemandangan sawah hijau dengan gunung di kejauhan.',
  'Seekor kucing oranye tidur di atas sofa.',
];
let captionIdx = 0;
backend.ai.caption = async ({ lang }) => {
  await new Promise((r) => setTimeout(r, 900)); // meniru waktu proses model
  const text = CAPTIONS[captionIdx++ % CAPTIONS.length];
  return { text, textEn: null, lang, model: 'demo', latencyMs: 900 };
};

// --- Situs berita contoh ---
const img = async (w, h, a, b) =>
  sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`)).png().toBuffer();
const files = {
  '/img/1.png': await img(520, 300, '#4f7cff', '#1b2a6b'),
  '/img/2.jpg': await sharp(await img(300, 300, '#ff6b6b', '#7a1010')).jpeg().toBuffer(),
  '/img/3.avif': await sharp(await img(520, 260, '#7ad37a', '#1f5e2a')).avif().toBuffer(),
  '/img/4.png': await img(300, 220, '#ffb347', '#a35400'),
};
const page = `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Kabar Kota — Berita Hari Ini</title>
<style>body{font:18px/1.6 Georgia,serif;margin:0;background:#faf8f3;color:#222}header{background:#8b0000;color:#fff;padding:14px 32px;font:700 26px Arial}main{max-width:760px;padding:24px 32px}figure{margin:18px 0}h2{font-family:Arial}</style></head>
<body><header>Kabar Kota</header><main>
<h2>Jalur sepeda baru resmi dibuka</h2><a id="link" href="#">Baca selengkapnya</a>
<figure><img src="/img/1.png" alt="" width="520" height="300"></figure>
<p>Pemerintah kota meresmikan jalur sepeda sepanjang 12 kilometer…</p>
<figure><img src="/img/2.jpg" alt="Produk" width="300" height="300"></figure>
<figure><img src="/img/3.avif" width="520" height="260"></figure>
<figure><img src="/img/4.png" alt="" width="300" height="220"></figure>
</main></body></html>`;
const site = http.createServer((req, res) => {
  const f = files[req.url];
  if (f) {
    res.writeHead(200, { 'content-type': req.url.endsWith('.jpg') ? 'image/jpeg' : req.url.endsWith('.avif') ? 'image/avif' : 'image/png' });
    return res.end(f);
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(page);
});
await new Promise((r) => site.listen(0, '127.0.0.1', r));
const SITE = `http://127.0.0.1:${site.address().port}/berita.html`;

// --- Chromium + extension, perekaman video ---
const SIZE = { width: 1280, height: 720 };
const context = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'nv-demo-')), {
  channel: 'chromium',
  headless: true,
  // viewport null + tinggi jendela 860: area halaman tepat 1280×720 di rekaman (dengan extension aktif,
  // screencast headless memotong tinggi viewport bila viewport diemulasikan).
  viewport: null,
  recordVideo: { dir: rawDir, size: SIZE },
  args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--window-size=1280,860'],
});
context.on('page', (p) => p.on('dialog', (d) => d.accept()));
let [sw] = context.serviceWorkers();
if (!sw) sw = await context.waitForEvent('serviceworker');
for (let i = 0; i < 50 && !(await sw.evaluate(() => Boolean(globalThis.chrome?.storage && globalThis.naraVisi))); i++) {
  await new Promise((r) => setTimeout(r, 100));
}
await sw.evaluate((apiBase) => chrome.storage.sync.set({ apiBase }), `${backend.base}/api/v1`);
const ext = (p) => `chrome-extension://${new URL(sw.url()).host}/${p}`;

const tab = await context.newPage();
const pause = (ms) => tab.waitForTimeout(ms);

/** Keterangan di layar (bagian atas). */
async function caption(text, sub = '') {
  await tab.evaluate(
    ([t, s]) => {
      let bar = document.getElementById('__demo_cap');
      if (!bar) {
        bar = document.createElement('div');
        bar.id = '__demo_cap';
        bar.style.cssText =
          'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:2147483647;max-width:1100px;' +
          'background:rgba(17,17,17,.92);color:#fff;padding:12px 22px;border-radius:12px;font:600 21px/1.4 system-ui,Arial;' +
          'box-shadow:0 8px 24px rgba(0,0,0,.35);text-align:center;pointer-events:none';
        document.documentElement.appendChild(bar);
      }
      bar.innerHTML = '';
      const a = document.createElement('div');
      a.textContent = t;
      bar.appendChild(a);
      if (s) {
        const b = document.createElement('div');
        b.textContent = s;
        b.style.cssText = 'font:400 17px/1.4 system-ui,Arial;color:#ffd77a;margin-top:4px';
        bar.appendChild(b);
      }
    },
    [text, sub],
  );
}

async function titleCard(lines, ms) {
  await tab.setContent(`<!doctype html><html><body style="margin:0;height:100vh;display:grid;place-items:center;background:#0b57d0;color:#fff;font-family:system-ui,Arial;text-align:center">
    <div>${lines.map((l, i) => `<div style="font-size:${i === 0 ? 64 : 26}px;font-weight:${i === 0 ? 800 : 400};margin:${i === 0 ? '0 0 18px' : '6px 0'}">${l}</div>`).join('')}</div></body></html>`);
  await pause(ms);
}

const panelStatus = tab.locator('#nv-status');
const spoken = async () => tab.locator('#naravisi-host').getAttribute('data-last-spoken');
const toggle = () =>
  sw.evaluate(async (u) => {
    const [t] = await chrome.tabs.query({ url: u });
    return globalThis.naraVisi.togglePanel(t.id);
  }, SITE);

try {
  // 0. Pembuka
  await titleCard(['NaraVisi', 'Deskripsi gambar berbasis AI yang dibacakan dengan suara', 'untuk pengguna tunanetra', '<br>Demo v1.0 · Rifat Arifaldo (11241078)', '<span style="font-size:18px;opacity:.85">Rekaman otomatis · model AI disimulasikan · suara TTS ditampilkan sebagai teks</span>'], 5000);

  // 1. Registrasi
  await tab.goto(ext('popup/popup.html'));
  await caption('1. Daftar akun dari popup NaraVisi', 'UC-AKUN-01 · akun baru otomatis berstatus Gratis (10 deskripsi/hari)');
  await pause(1500);
  await tab.getByRole('tab', { name: 'Daftar' }).click();
  await tab.getByLabel('Nama').pressSequentially('Rifat', { delay: 70 });
  await tab.getByLabel('Email').last().pressSequentially('rifat@contoh.id', { delay: 50 });
  await tab.getByLabel('Kata sandi (minimal 8 karakter)').pressSequentially('sandiku123', { delay: 50 });
  await pause(500);
  await tab.getByRole('button', { name: 'Daftar', exact: true }).click();
  await tab.locator('#member:not([hidden])').waitFor();
  await caption('Berhasil masuk', 'Popup menampilkan status Gratis dan sisa kuota hari ini');
  await pause(3000);

  // 2. Pindai & deskripsikan
  await tab.goto(SITE);
  await tab.focus('#link');
  await caption('2. Buka situs berita, tekan Alt+Shift+N', 'UC-GBR-01/02 · gambar ditandai dan didaftar di Panel NaraVisi');
  await pause(2200);
  await toggle();
  await panelStatus.filter({ hasText: 'gambar ditemukan' }).waitFor();
  await pause(2500);
  await caption('3. Tekan Enter untuk mendeskripsikan gambar terpilih', 'UC-GBR-04..06 · gambar dikirim ke layanan AI');
  await pause(1200);
  await tab.keyboard.press('Enter');
  await panelStatus.filter({ hasText: 'siap' }).waitFor({ timeout: 15000 });
  await caption('🔊 Dibacakan (TTS):', `“${await spoken()}”`);
  await pause(4000);

  await caption('4. Panah bawah memilih gambar berikutnya', 'Gambar format AVIF otomatis dikonversi oleh extension');
  await tab.keyboard.press('ArrowDown');
  await pause(900);
  await tab.keyboard.press('ArrowDown');
  await pause(900);
  await tab.keyboard.press('Enter');
  await panelStatus.filter({ hasText: 'Deskripsi gambar 3 siap' }).waitFor({ timeout: 15000 });
  await caption('🔊 Dibacakan (TTS):', `“${await spoken()}”`);
  await pause(3500);

  // 3. Laporkan
  await caption('5. Tekan L untuk melaporkan deskripsi yang keliru', 'UC-LAP-01');
  await tab.keyboard.press('l');
  await tab.locator('#nv-reason').pressSequentially('Itu bukan sawah, tapi taman kota.', { delay: 40 });
  await pause(600);
  await tab.getByRole('button', { name: 'Kirim laporan' }).click();
  await panelStatus.filter({ hasText: 'Laporan Anda sudah dikirim' }).waitFor();
  await pause(2800);
  await tab.keyboard.press('Escape');

  // 4. Riwayat
  await tab.goto(ext('pages/riwayat.html'));
  await tab.locator('.item').first().waitFor();
  await caption('6. Riwayat deskripsi', 'UC-RWY-02..04 · putar ulang, laporkan, hapus · Gratis: 7 hari terakhir');
  await pause(4000);

  // 5. Pengaturan
  await tab.goto(ext('pages/pengaturan.html'));
  await tab.locator('#kecepatan').waitFor();
  await caption('7. Pengaturan suara & aksesibilitas', 'UC-AKS-01..03 · kecepatan untuk semua; nada & jenis suara khusus Premium');
  await pause(2500);
  await tab.locator('#kecepatan').fill('1.4');
  await tab.getByRole('button', { name: 'Simpan pengaturan' }).click();
  await tab.locator('#msg', { hasText: 'Pengaturan berhasil disimpan.' }).waitFor();
  await pause(2500);

  // 6. Kuota habis
  const userId = (await backend.db.get('SELECT user_id FROM users WHERE email = ?', ['rifat@contoh.id'])).user_id;
  await backend.db.run('UPDATE kuota_harian SET jumlah_permintaan = 10 WHERE user_id = ?', [userId]);
  await tab.goto(SITE);
  await toggle();
  await panelStatus.filter({ hasText: 'gambar ditemukan' }).waitFor();
  await caption('8. Kuota Gratis habis (10/hari)', 'Pesan dibacakan dan panel menawarkan paket Premium');
  await tab.keyboard.press('ArrowDown');
  await tab.keyboard.press('Enter');
  await panelStatus.filter({ hasText: 'Kuota harian' }).waitFor({ timeout: 10000 });
  await pause(4000);

  // 7. Premium
  await tab.goto(ext('pages/premium.html'));
  await tab.locator('.price').waitFor();
  await caption('9. Upgrade Premium — Rp15.000 / 30 hari', 'UC-PRM-01..03 · Midtrans Snap (di demo: mode simulasi)');
  await pause(2500);
  const [payTab] = await Promise.all([context.waitForEvent('page'), tab.getByRole('button', { name: 'Beli Premium Bulanan' }).click()]);
  await payTab.waitForLoadState();
  const payUrl = payTab.url();
  await payTab.close();
  await tab.goto(payUrl);
  await caption('Halaman pembayaran', 'Dengan kunci Midtrans: QRIS / e-wallet / transfer bank');
  await pause(2500);
  await tab.getByRole('button', { name: 'Bayar (simulasi berhasil)' }).click();
  await pause(2000);
  await tab.goto(ext('pages/premium.html'));
  await tab.locator('.badge.premium').waitFor();
  await caption('Akun kini Premium', 'UC-PRM-04 · masa aktif tampil; kuota tanpa batas');
  await pause(3500);

  await tab.goto(SITE);
  await toggle();
  await panelStatus.filter({ hasText: 'gambar ditemukan' }).waitFor();
  await tab.keyboard.press('End');
  await tab.keyboard.press('Enter');
  await panelStatus.filter({ hasText: 'siap' }).waitFor({ timeout: 15000 });
  await caption('🔊 Premium — tanpa batas kuota:', `“${await spoken()}”`);
  await pause(3500);
  await tab.keyboard.press('Escape');

  // 8. Admin
  await tab.goto(`${backend.base}/admin/`);
  await caption('10. Dashboard Admin (web)', 'UC-ADM-01..04 · UC-LAP-02..03');
  await tab.locator('#login-email').pressSequentially(ADMIN.email, { delay: 30 });
  await tab.locator('#login-password').pressSequentially(ADMIN.password, { delay: 30 });
  await tab.getByRole('button', { name: 'Masuk' }).click();
  await tab.locator('#users-body tr', { hasText: 'rifat@contoh.id' }).waitFor();
  await caption('Daftar pengguna', 'Rifat tercatat sebagai Premium');
  await pause(3500);
  await tab.getByRole('tab', { name: 'Laporan deskripsi' }).click();
  await tab.locator('.report').first().waitFor();
  await caption('Laporan dari pengguna', 'Gambar, deskripsi AI, dan alasan pelaporan');
  await pause(3000);
  await tab.getByRole('button', { name: 'Tinjau' }).first().click();
  await tab.getByLabel('Tindak lanjut').pressSequentially('Dicatat untuk evaluasi model.', { delay: 35 });
  await tab.locator('#review-dialog').getByRole('button', { name: 'Simpan' }).click();
  await tab.locator('#toast', { hasText: 'Status laporan berhasil diperbarui.' }).waitFor();
  await tab.locator('#report-filter').selectOption('');
  await tab.locator('.report').first().waitFor();
  await caption('Laporan ditandai "Sudah ditinjau"', 'Tindak lanjut & nama peninjau tercatat');
  await pause(3000);

  // 9. Penutup
  await titleCard(['Terima kasih', '30/30 kebutuhan fungsional · 80 tes backend · 48 skenario E2E', 'Chrome MV3 · Express 5 · MySQL 8.4 · FastAPI + BLIP · Midtrans'], 4000);
} finally {
  const videoPath = await tab.video().path();
  await context.close();
  site.close();
  await backend.close();
  const webm = path.join(outDir, 'naravisi-demo.webm');
  renameSync(videoPath, webm);
  rmSync(rawDir, { recursive: true, force: true });
  console.log('Video:', webm);
  try {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(outDir, 'naravisi-demo.mp4')]);
    console.log('Video:', path.join(outDir, 'naravisi-demo.mp4'));
  } catch {
    console.log('(ffmpeg tidak tersedia — hanya .webm)');
  }
}
