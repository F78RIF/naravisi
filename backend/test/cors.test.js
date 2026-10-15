// CORS dibatasi ke ALLOWED_ORIGINS (pengganti 'Access-Control-Allow-Origin: *').
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { isOriginAllowed, parseAllowedOrigins } from '../src/http/cors.js';
import { startTestApp } from './support/testApp.js';

const EXT = 'chrome-extension://pkkfgojmmeddfaagcajmgamghbienlhh';

describe('CORS: ALLOWED_ORIGINS diisi', () => {
  let app;
  before(async () => {
    app = await startTestApp({ env: { ALLOWED_ORIGINS: `${EXT}, https://naravisi.id/` } });
  });
  after(() => app.close());

  it('origin extension yang terdaftar mendapat Allow-Origin miliknya sendiri (bukan *)', async () => {
    const res = await app.api('GET', '/api/v1/health', { headers: { origin: EXT } });
    assert.equal(res.headers.get('access-control-allow-origin'), EXT);
    assert.match(res.headers.get('vary'), /Origin/);
  });

  it('situs web lain tidak mendapat header Allow-Origin', async () => {
    const res = await app.api('GET', '/api/v1/health', { headers: { origin: 'https://situs-jahat.example' } });
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  });

  it('preflight OPTIONS: hanya origin terdaftar yang diberi izin metode & header', async () => {
    const ok = await app.api('OPTIONS', '/api/v1/descriptions', { headers: { origin: 'https://naravisi.id' } });
    assert.equal(ok.status, 204);
    assert.equal(ok.headers.get('access-control-allow-origin'), 'https://naravisi.id');
    assert.match(ok.headers.get('access-control-allow-headers'), /authorization/);

    const bad = await app.api('OPTIONS', '/api/v1/descriptions', { headers: { origin: 'https://situs-jahat.example' } });
    assert.equal(bad.headers.get('access-control-allow-origin'), null);
    assert.equal(bad.headers.get('access-control-allow-methods'), null);
  });

  it('localhost tidak otomatis diizinkan bila daftar diisi', async () => {
    const res = await app.api('GET', '/api/v1/health', { headers: { origin: 'http://localhost:5173' } });
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  });
});

describe('CORS: ALLOWED_ORIGINS kosong (development)', () => {
  it('hanya http://localhost dan http://127.0.0.1 yang diizinkan', () => {
    assert.deepEqual(parseAllowedOrigins(''), []);
    assert.equal(isOriginAllowed('http://localhost:3000', []), true);
    assert.equal(isOriginAllowed('http://127.0.0.1:8080', []), true);
    assert.equal(isOriginAllowed('http://localhost.situs-jahat.example', []), false);
    assert.equal(isOriginAllowed('https://situs-jahat.example', []), false);
    assert.equal(isOriginAllowed(EXT, []), false);
    assert.equal(isOriginAllowed(undefined, []), false);
  });
});
