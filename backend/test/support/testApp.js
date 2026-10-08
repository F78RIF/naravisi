import { createHash } from 'node:crypto';
import { loadConfig } from '../../src/config.js';
import { createServices } from '../../src/container.js';
import { createSqliteDb } from '../../src/db/index.js';
import { seedAdmin, seedPlans } from '../../src/db/seed.js';
import { createNodeServer } from '../../src/http/nodeServer.js';
import { createMidtransClient } from '../../src/services/midtransClient.js';
import { Errors } from '../../src/lib/errors.js';

export const ADMIN = { nama: 'Admin Uji', email: 'admin@uji.id', password: 'adminrahasia1' };
export const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** Jam yang bisa dimajukan untuk menguji kuota harian, masa riwayat, kedaluwarsa token, dll. */
export function fakeClock(start = '2026-10-08T03:00:00Z') {
  let t = new Date(start).getTime();
  return {
    now: () => new Date(t),
    advanceDays(n) {
      t += n * 86400000;
    },
    set(iso) {
      t = new Date(iso).getTime();
    },
  };
}

export function fakeAi() {
  const ai = {
    fail: null,
    calls: 0,
    async caption({ lang }) {
      ai.calls += 1;
      if (ai.fail) throw ai.fail;
      return { text: 'Seekor kucing duduk di atas sofa.', textEn: 'A cat sitting on a sofa.', lang, model: 'fake', latencyMs: 1 };
    },
    async health() {
      return { ok: true, provider: 'fake' };
    },
  };
  return ai;
}
fakeAi.unavailable = () => Errors.aiUnavailable();

/** Midtrans palsu di level HTTP: menguji klien Midtrans yang sebenarnya. */
export function fakeMidtransHttp(serverKey) {
  const state = { statuses: new Map(), created: [] };
  const json = (status, body) => ({ status, ok: status < 300, json: async () => body });
  state.fetch = async (url, init) => {
    if (url.endsWith('/snap/v1/transactions')) {
      const body = JSON.parse(init.body);
      state.created.push({ body, auth: init.headers.authorization });
      return json(201, { token: 'tok-123', redirect_url: `https://app.sandbox.midtrans.com/snap/v4/redirection/tok-123` });
    }
    const m = /\/v2\/([^/]+)\/status$/.exec(url);
    if (m) {
      const st = state.statuses.get(decodeURIComponent(m[1]));
      return st ? json(200, st) : json(404, { status_code: '404' });
    }
    return json(404, {});
  };
  state.notification = (orderId, transactionStatus, gross = '15000.00', extra = {}) => {
    const statusCode = transactionStatus === 'settlement' || transactionStatus === 'capture' ? '200' : '201';
    return {
      order_id: orderId,
      status_code: statusCode,
      gross_amount: gross,
      transaction_status: transactionStatus,
      payment_type: 'qris',
      signature_key: createHash('sha512').update(`${orderId}${statusCode}${gross}${serverKey}`).digest('hex'),
      ...extra,
    };
  };
  return state;
}

export async function startTestApp({ midtransKey = '', env = {} } = {}) {
  const config = loadConfig({ JWT_SECRET: 'rahasia-uji', PUBLIC_URL: 'http://naravisi.test', ...env });
  config.midtrans.serverKey = midtransKey;
  const db = await createSqliteDb(':memory:');
  await seedPlans(db);
  await seedAdmin(db, { nama: ADMIN.nama, email: ADMIN.email, password: ADMIN.password });
  const clock = fakeClock();
  const ai = fakeAi();
  const mtHttp = midtransKey ? fakeMidtransHttp(midtransKey) : null;
  const midtrans = createMidtransClient({ serverKey: midtransKey, isProduction: false, fetchImpl: mtHttp?.fetch });
  const services = createServices({ db, config, aiClient: ai, clock, midtrans });
  const server = createNodeServer(services);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function api(method, path, { token, body, form } = {}) {
    const headers = {};
    if (token) headers.authorization = `Bearer ${token}`;
    let payload;
    if (form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      payload = new URLSearchParams(form).toString();
    } else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = typeof body === 'string' ? body : JSON.stringify(body);
    }
    const res = await fetch(`${base}${path}`, { method, headers, body: payload, redirect: 'manual' });
    const text = await res.text();
    let data = text;
    try {
      data = JSON.parse(text);
    } catch {
      // HTML
    }
    return { status: res.status, body: data, headers: res.headers };
  }

  let seq = 0;
  async function register(overrides = {}) {
    seq += 1;
    const body = { nama: `Pengguna ${seq}`, email: `pengguna${seq}@uji.id`, kata_sandi: 'sandiku123', ...overrides };
    const res = await api('POST', '/api/v1/auth/register', { body });
    if (res.status !== 201) throw new Error(`register gagal: ${JSON.stringify(res.body)}`);
    return { token: res.body.token, user: res.body.user, password: body.kata_sandi, email: body.email };
  }

  async function loginAdmin() {
    const res = await api('POST', '/api/v1/auth/login', { body: { email: ADMIN.email, kata_sandi: ADMIN.password } });
    return res.body.token;
  }

  const describe = (token, extra = {}) =>
    api('POST', '/api/v1/descriptions', {
      token,
      body: { image_base64: PNG_1PX, page_url: 'https://berita.id/a', image_url: 'https://berita.id/a.png', ...extra },
    });

  async function close() {
    await new Promise((r) => server.close(r));
    await db.close();
  }

  return { api, base, db, clock, ai, services, mtHttp, register, loginAdmin, describe, close };
}
