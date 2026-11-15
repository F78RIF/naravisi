// NaraVisi · scripts/ukur-lapis-lokal.mjs
// Fungsi   : Mengukur lapis lokal dengan detektor ASLI di Chromium (Playwright): benda (MediaPipe, PF-05), warna (PF-08),
//            tulisan (Tesseract, PF-06), kode QR (jsQR/BarcodeDetector, PF-07). Mencatat waktu muat pertama, median
//            10 gambar per lapis, waktu keempatnya dijalankan paralel, hasil kalimat tiap gambar, dan tambahan ukuran
//            extension dibanding commit sebelum lapis lokal. Hasil dicatat apa adanya di docs/PENGUJIAN.md.
// Kebutuhan: PF-05, PF-06, PF-07, PF-08
// Pemakaian: node examples/buat_gambar_lapis_lokal.mjs && node scripts/ukur-lapis-lokal.mjs [commit-pembanding]
//            (bawaan pembanding: e3e273a, commit terakhir sebelum PF-06..PF-08; butuh: cd e2e && npm install)

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'e2e/package.json'));
const { chromium } = require('playwright');
const GAMBAR = path.join(ROOT, 'examples/gambar/lapis-lokal');
const PEMBANDING = process.argv[2] || 'e3e273a';
const PUTARAN = 3;

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return Math.round((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) * 10) / 10;
};

// [PF-06] Teks di gambar (OCR) — ukuran extension: berkas di bawah extension/ pada commit pembanding vs pohon kerja
function ukuranExtension() {
  const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const lama = git('ls-tree', '-r', '-l', PEMBANDING, '--', 'extension').trim().split('\n').map((l) => {
    const [meta, file] = l.split('\t');
    return { file, bytes: Number(meta.trim().split(/\s+/)[3]), sha: meta.trim().split(/\s+/)[2] };
  });
  const zipLama = lama.reduce((n, f) => n + deflateRawSync(execFileSync('git', ['cat-file', 'blob', f.sha], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }), { level: 9 }).length, 0);
  const baru = git('ls-files', '--', 'extension').trim().split('\n').map((file) => {
    const buf = readFileSync(path.join(ROOT, file));
    return { file, bytes: buf.length, zip: deflateRawSync(buf, { level: 9 }).length };
  });
  const sum = (a, k) => a.reduce((n, f) => n + f[k], 0);
  const perFolder = {};
  const namaLama = new Set(lama.map((f) => f.file));
  for (const f of baru) {
    if (namaLama.has(f.file)) continue;
    const kunci = f.file.split('/').slice(0, 3).join('/');
    perFolder[kunci] = (perFolder[kunci] ?? 0) + f.bytes;
  }
  return { mentahLama: sum(lama, 'bytes'), mentahBaru: sum(baru, 'bytes'), zipLama, zipBaru: sum(baru, 'zip'), perFolder };
}

const profil = mkdtempSync(path.join(tmpdir(), 'nvu-'));
const ext = path.join(ROOT, 'extension');
const ctx = await chromium.launchPersistentContext(profil, {
  headless: true, channel: 'chromium', args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
try {
  let [sw] = ctx.serviceWorkers();
  sw ??= await ctx.waitForEvent('serviceworker');
  for (let i = 0; i < 50 && !(await sw.evaluate(() => Boolean(globalThis.naraVisi))); i++) await new Promise((r) => setTimeout(r, 100));
  const files = readdirSync(GAMBAR).filter((f) => f.endsWith('.png')).sort();
  const data = Object.fromEntries(files.map((f) => [f, `data:image/png;base64,${readFileSync(path.join(GAMBAR, f)).toString('base64')}`]));
  const lapis = {
    benda: (d) => globalThis.naraVisi.detectImage({ dataUrl: d }),
    tulisan: (d) => globalThis.naraVisi.readTextImage({ dataUrl: d }),
    kode: (d) => globalThis.naraVisi.readCodesImage({ dataUrl: d }),
  };
  const ukur = (nama, d) => sw.evaluate(async ({ nama, d, kode }) => {
    const fn = new Function(`return (${kode})`)();
    const t0 = performance.now();
    const r = await fn(d);
    return { r, total: performance.now() - t0, nama };
  }, { nama, d, kode: lapis[nama].toString() });

  const pertama = {};
  const ms = { benda: [], warna: [], tulisan: [], kode: [] };
  const total = { benda: [], tulisan: [], kode: [], paralel: [] };
  const hasil = {};
  for (let putaran = 0; putaran < PUTARAN; putaran++) {
    for (const f of files) {
      for (const nama of ['benda', 'tulisan', 'kode']) {
        const { r, total: t } = await ukur(nama, data[f]);
        if (!pertama[nama]) {
          pertama[nama] = { file: f, ms: r.ms, muatMs: r.muatMs ?? null, total: Math.round(t) };
          continue; // panggilan pertama = memuat mesin; tidak dihitung di median
        }
        ms[nama].push(r.ms);
        total[nama].push(t);
        if (nama === 'benda') ms.warna.push(r.warnaMs ?? 0);
        if (putaran === 0) hasil[f] = { ...(hasil[f] ?? {}), [nama]: r };
      }
      if (putaran > 0) {
        const t0 = performance.now();
        await Promise.all(['benda', 'tulisan', 'kode'].map((n) => ukur(n, data[f])));
        total.paralel.push(performance.now() - t0);
      }
    }
  }
  // Hasil putaran pertama gambar pertama (dipakai untuk memuat) diulang agar tabel lengkap.
  for (const f of files) for (const nama of ['benda', 'tulisan', 'kode']) {
    if (!hasil[f]?.[nama]) hasil[f] = { ...(hasil[f] ?? {}), [nama]: (await ukur(nama, data[f])).r };
  }

  console.log(`Chromium ${ctx.browser()?.version() ?? ''} · ${files.length} gambar × ${PUTARAN} putaran · mesin QR: ${hasil[files[0]].kode.mesin}\n`);
  console.log('Panggilan pertama (memuat mesin):', JSON.stringify(pertama));
  console.log('\nMedian per lapis (ms, di dalam offscreen):');
  for (const [k, v] of Object.entries(ms)) console.log(`  ${k.padEnd(8)} n=${v.length} median=${median(v)} maks=${Math.round(Math.max(...v))}`);
  console.log('Median total dari service worker (normalisasi + pesan + lapis, ms):');
  for (const [k, v] of Object.entries(total)) console.log(`  ${k.padEnd(8)} n=${v.length} median=${median(v)}`);
  console.log('\nHasil per gambar:');
  for (const f of files) {
    const h = hasil[f];
    const warna = (h.benda.warna ?? []).map((w) => `${w.nama} ${Math.round(w.porsi * 100)}%`).join(', ');
    console.log(`  ${f}\n    benda: "${h.benda.kalimat}" polos=${h.benda.polos} warna=[${warna}]\n    tulisan: ${JSON.stringify(h.tulisan.kalimat)}\n    kode: ${JSON.stringify(h.kode.kalimat)}`);
  }
  const u = ukuranExtension();
  const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;
  console.log(`\nUkuran extension (berkas di git): ${PEMBANDING} ${mb(u.mentahLama)} → sekarang ${mb(u.mentahBaru)} (+${mb(u.mentahBaru - u.mentahLama)})`);
  console.log(`Perkiraan terkompres (deflate per berkas, mirip .zip): ${mb(u.zipLama)} → ${mb(u.zipBaru)} (+${mb(u.zipBaru - u.zipLama)})`);
  console.log('Berkas baru per folder:', Object.entries(u.perFolder).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${mb(v)}`).join('; '));
} finally {
  await ctx.close();
  rmSync(profil, { recursive: true, force: true, maxRetries: 3 });
}
