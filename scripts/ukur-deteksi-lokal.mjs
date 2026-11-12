// NaraVisi · scripts/ukur-deteksi-lokal.mjs
// Fungsi   : Mengukur waktu deteksi objek lokal (PF-05) dengan detektor MediaPipe asli di Chromium (Playwright):
//            waktu muat model, deteksi pertama, lalu p50/p95 deteksi berikutnya. Hasil dicatat di docs/PENGUJIAN.md 3d.
// Kebutuhan: PF-05
// Pemakaian: node scripts/ukur-deteksi-lokal.mjs . ai-service/eval/data/images
//            (argumen 1 = akar repo, argumen 2 = folder berisi .jpg; butuh: cd e2e && npm install)
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const [repo, dir] = process.argv.slice(2);
const require = createRequire(path.join(repo, 'e2e/package.json'));
const { chromium } = require('playwright');
const ext = path.join(repo, 'extension');
const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'nv-')), {
  headless: true, channel: 'chromium', args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
let [sw] = ctx.serviceWorkers(); sw ??= await ctx.waitForEvent('serviceworker');
for (let i = 0; i < 50 && !(await sw.evaluate(() => Boolean(globalThis.naraVisi))); i++) await new Promise((r) => setTimeout(r, 100));
const files = readdirSync(dir).filter((f) => /\.jpe?g$/i.test(f)).sort().slice(0, 10);
const det = [], total = []; let first;
for (let round = 0; round < 3; round++) for (const f of files) {
  const dataUrl = 'data:image/jpeg;base64,' + readFileSync(path.join(dir, f)).toString('base64');
  const t0 = performance.now();
  const r = await sw.evaluate((d) => globalThis.naraVisi.detectImage({ dataUrl: d }), dataUrl);
  const t = performance.now() - t0;
  if (!first) { first = { muatMs: r.muatMs, ms: r.ms, total: Math.round(t) }; continue; }
  det.push(r.ms); total.push(t);
  if (round === 0) console.log(f, JSON.stringify({ kalimat: r.kalimat, polos: r.polos, variansi: r.variansi, ms: r.ms }));
}
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]); };
console.log('pertama', JSON.stringify(first));
console.log(`n=${det.length} deteksi p50=${q(det, .5)} p95=${q(det, .95)} | total (normalisasi+pesan+deteksi) p50=${q(total, .5)} p95=${q(total, .95)}`);
await ctx.close();
