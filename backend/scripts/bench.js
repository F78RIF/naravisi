// Mengukur waktu respons endpoint non-AI (RNF-05: ≤ 2 detik) dan overhead backend
// pada /descriptions (model AI dipalsukan agar yang terukur hanya kerja backend).
// Pemakaian: node --no-warnings scripts/bench.js [jumlah_permintaan]
import { performance } from 'node:perf_hooks';
import { startTestApp } from '../test/support/testApp.js';

const N = Number(process.argv[2] || 200);
const app = await startTestApp();
app.clock.set(new Date().toISOString());

const u = await app.register({ nama: 'Bench', email: 'bench@uji.id' });
// Isi riwayat 200 baris agar query riwayat realistis
for (let i = 0; i < 200; i++) {
  await app.db.run(
    'INSERT INTO riwayat_deskripsi (user_id, url_halaman, url_gambar, teks_deskripsi, waktu_dibuat) VALUES (?, ?, ?, ?, ?)',
    [u.user.user_id, `https://berita.id/${i}`, `https://berita.id/${i}.jpg`, 'Seekor kucing duduk di atas sofa.', new Date(Date.now() - i * 3600e3).toISOString().slice(0, 19).replace('T', ' ')],
  );
}

const cases = [
  ['GET /me', () => app.api('GET', '/api/v1/me', { token: u.token })],
  ['GET /me/quota', () => app.api('GET', '/api/v1/me/quota', { token: u.token })],
  ['GET /history', () => app.api('GET', '/api/v1/history?limit=20', { token: u.token })],
  ['GET /settings', () => app.api('GET', '/api/v1/settings', { token: u.token })],
  ['PUT /settings', () => app.api('PUT', '/api/v1/settings', { token: u.token, body: { kecepatan_suara: 1.2 } })],
  ['GET /plans', () => app.api('GET', '/api/v1/plans')],
  ['POST /auth/login', () => app.api('POST', '/api/v1/auth/login', { body: { email: 'bench@uji.id', kata_sandi: u.password } }), 50],
  ['POST /descriptions*', async () => {
    await app.db.run('DELETE FROM kuota_harian');
    return app.describe(u.token);
  }],
];

const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))];
const rows = [];
for (const [name, fn, n = N] of cases) {
  await fn(); // pemanasan
  const t = [];
  for (let i = 0; i < n; i++) {
    const s = performance.now();
    const res = await fn();
    t.push(performance.now() - s);
    if (res.status >= 400) throw new Error(`${name} gagal: ${res.status} ${JSON.stringify(res.body)}`);
  }
  t.sort((a, b) => a - b);
  rows.push({ endpoint: name, n, p50: pct(t, 50).toFixed(1), p95: pct(t, 95).toFixed(1), max: t.at(-1).toFixed(1) });
}
await app.close();

console.log('| Endpoint | n | p50 (ms) | p95 (ms) | maks (ms) |');
console.log('|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.endpoint} | ${r.n} | ${r.p50} | ${r.p95} | ${r.max} |`);
console.log('\n* /descriptions: model AI dipalsukan — angka = overhead backend (validasi, kuota, riwayat).');
