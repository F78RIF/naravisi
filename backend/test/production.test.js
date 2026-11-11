// Mode production (APP_ENV=production): server menolak start bila kunci kosong, dan halaman simulasi tidak terdaftar.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { ConfigError, loadConfig } from '../src/config.js';
import { startTestApp } from './support/testApp.js';

const PROD = {
  APP_ENV: 'production',
  JWT_SECRET: 'k'.repeat(48),
  PUBLIC_URL: 'https://naravisi.example',
  ALLOWED_ORIGINS: 'chrome-extension://pkkfgojmmeddfaagcajmgamghbienlhh',
  MIDTRANS_SERVER_KEY: 'kunci-sandbox-palsu-uji',
  MIDTRANS_IS_PRODUCTION: 'false',
};
const without = (key) => Object.fromEntries(Object.entries(PROD).filter(([k]) => k !== key));
const problemsOf = (env) => {
  try {
    loadConfig(env);
  } catch (err) {
    assert.ok(err instanceof ConfigError, `seharusnya ConfigError, didapat: ${err.message}`);
    return err.problems;
  }
  return [];
};

describe('APP_ENV=production: konfigurasi wajib lengkap', () => {
  it('konfigurasi lengkap diterima; appEnv = production', () => {
    const config = loadConfig(PROD);
    assert.equal(config.appEnv, 'production');
    assert.equal(config.midtrans.isProduction, false);
  });

  it('tanpa kunci sama sekali → SEMUA masalah dilaporkan sekaligus', () => {
    const problems = problemsOf({ APP_ENV: 'production' });
    assert.equal(problems.length, 4);
    for (const name of ['JWT_SECRET', 'PUBLIC_URL', 'ALLOWED_ORIGINS', 'MIDTRANS_SERVER_KEY']) {
      assert.ok(problems.some((p) => p.startsWith(name)), `${name} disebut`);
    }
  });

  for (const key of ['JWT_SECRET', 'PUBLIC_URL', 'ALLOWED_ORIGINS', 'MIDTRANS_SERVER_KEY']) {
    it(`${key} kosong → ditolak dengan pesan yang menyebut ${key}`, () => {
      const problems = problemsOf(without(key));
      assert.equal(problems.length, 1);
      assert.match(problems[0], new RegExp(`^${key} kosong`));
    });
  }

  it('JWT_SECRET < 32 karakter ditolak', () => {
    assert.match(problemsOf({ ...PROD, JWT_SECRET: 'pendek' })[0], /JWT_SECRET terlalu pendek \(6 karakter\)/);
  });

  it('PUBLIC_URL http:// ditolak (wajib https)', () => {
    assert.match(problemsOf({ ...PROD, PUBLIC_URL: 'http://naravisi.example' })[0], /PUBLIC_URL harus diawali https:\/\//);
  });

  it('MIDTRANS_IS_PRODUCTION=true ditolak (wajib Sandbox)', () => {
    assert.match(problemsOf({ ...PROD, MIDTRANS_IS_PRODUCTION: 'true' })[0], /MIDTRANS_IS_PRODUCTION harus false/);
  });

  it('APP_ENV selain development/production ditolak', () => {
    assert.throws(() => loadConfig({ ...PROD, APP_ENV: 'staging' }), /APP_ENV harus "development" atau "production"/);
  });

  it('APP_ENV kosong = development (perilaku lama tetap)', () => {
    assert.equal(loadConfig({ JWT_SECRET: 'rahasia-uji' }).appEnv, 'development');
  });
});

describe('APP_ENV=production: server gagal start dengan pesan jelas', () => {
  const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const run = (extra) =>
    spawnSync(process.execPath, ['src/server.js'], {
      cwd: backendDir,
      // Lingkungan bersih: hanya yang dibutuhkan OS + variabel uji (tidak membaca backend/.env).
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...extra },
      encoding: 'utf8',
      timeout: 20000,
    });

  it('tanpa kunci → keluar kode 1, pesan menyebut semua variabel, tanpa jejak tumpukan', () => {
    const res = run({ APP_ENV: 'production' });
    assert.equal(res.status, 1, res.stderr);
    assert.match(res.stderr, /NaraVisi tidak dapat dijalankan \(APP_ENV=production\)/);
    for (const name of ['JWT_SECRET', 'PUBLIC_URL', 'ALLOWED_ORIGINS', 'MIDTRANS_SERVER_KEY']) {
      assert.match(res.stderr, new RegExp(`- ${name}`));
    }
    assert.match(res.stderr, /Perbaiki berkas backend\/\.env/);
    assert.doesNotMatch(res.stderr, /\s+at\s+\S+\s+\(/, 'tidak ada stack trace');
  });

  it('PUBLIC_URL http:// saja yang salah → hanya itu yang disebut', () => {
    const res = run({ ...PROD, PUBLIC_URL: 'http://naravisi.example' });
    assert.equal(res.status, 1, res.stderr);
    assert.match(res.stderr, /- PUBLIC_URL harus diawali https:\/\//);
    assert.doesNotMatch(res.stderr, /- JWT_SECRET/);
  });
});

describe('APP_ENV=production: rute simulasi pembayaran tidak terdaftar', () => {
  let prod;
  let dev;
  before(async () => {
    prod = await startTestApp({ midtransKey: PROD.MIDTRANS_SERVER_KEY, env: PROD });
    dev = await startTestApp();
  });
  after(async () => {
    await prod.close();
    await dev.close();
  });

  it('production: GET & POST /pay/simulate/:orderId → 404', async () => {
    assert.equal((await prod.api('GET', '/pay/simulate/NV-1')).status, 404);
    assert.equal((await prod.api('POST', '/pay/simulate/NV-1', { form: { hasil: 'berhasil' } })).status, 404);
  });

  it('production: pembayaran memakai Midtrans Sandbox, bukan simulasi', async () => {
    assert.equal(prod.services.payments.mode, 'sandbox');
  });

  it('development: halaman simulasi tetap ada (untuk tes & pengembangan)', async () => {
    assert.equal(dev.services.payments.mode, 'simulasi');
    const u = await dev.register();
    const { body: plans } = await dev.api('GET', '/api/v1/plans');
    const pay = await dev.api('POST', '/api/v1/payments', { token: u.token, body: { paket_id: plans.items[0].paket_id } });
    assert.equal((await dev.api('GET', `/pay/simulate/${pay.body.order_id}`)).status, 200);
  });
});
