import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dispatch } from './dispatch.js';
import { buildRoutes } from './routes.js';

/**
 * Adaptor node:http untuk tabel rute yang sama dengan Express.
 * Dipakai pengujian otomatis agar tidak bergantung pada paket npm.
 * Server produksi tetap memakai Express (src/app.js).
 */
const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

function compile(routePath) {
  const keys = [];
  const re = routePath.replace(/:([A-Za-z]+)/g, (_, k) => {
    keys.push(k);
    return '([^/]+)';
  });
  return { re: new RegExp(`^${re}$`), keys };
}

async function readBody(req, limit) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      const err = new Error('too large');
      err.type = 'entity.too.large';
      throw err;
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  const type = req.headers['content-type'] || '';
  if (!raw) return {};
  if (type.includes('application/json')) {
    try {
      return JSON.parse(raw);
    } catch {
      const err = new Error('parse');
      err.type = 'entity.parse.failed';
      throw err;
    }
  }
  if (type.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw));
  return {};
}

export function createNodeServer(services) {
  const routes = buildRoutes(services).map((r) => ({ ...r, ...compile(r.path) }));
  const limit = Math.ceil((services.config.maxImageBytes * 4) / 3) + 64 * 1024;

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const write = (status, payload, type = 'application/json; charset=utf-8') => {
      res.writeHead(status, { 'content-type': type, 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' });
      res.end(type.startsWith('application/json') ? JSON.stringify(payload) : payload);
    };

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'content-type, authorization',
        'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      });
      return res.end();
    }

    if (url.pathname === '/admin') {
      res.writeHead(302, { location: '/admin/' });
      return res.end();
    }
    if (url.pathname.startsWith('/admin/') && req.method === 'GET') {
      const rel = url.pathname === '/admin/' ? 'index.html' : url.pathname.slice('/admin/'.length);
      const file = path.join(publicDir, 'admin', path.normalize(rel));
      if (!file.startsWith(path.join(publicDir, 'admin'))) return write(404, { error: { code: 'NOT_FOUND' } });
      try {
        return write(200, await readFile(file), MIME[path.extname(file)] || 'application/octet-stream');
      } catch {
        return write(404, { error: { code: 'NOT_FOUND', message: 'Endpoint tidak ditemukan.' } });
      }
    }

    for (const route of routes) {
      if (route.method !== req.method) continue;
      const m = route.re.exec(url.pathname);
      if (!m) continue;
      let body;
      try {
        body = await readBody(req, limit);
      } catch (err) {
        if (err.type === 'entity.too.large') {
          return write(413, { error: { code: 'IMAGE_TOO_LARGE', message: 'Ukuran permintaan terlalu besar.' } });
        }
        return write(400, { error: { code: 'INVALID_REQUEST', message: 'Badan permintaan bukan JSON yang valid.' } });
      }
      const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const out = await dispatch(
        route,
        { params, query: Object.fromEntries(url.searchParams), body, headers: req.headers },
        services,
      );
      return out.html !== undefined
        ? write(out.status, out.html, 'text/html; charset=utf-8')
        : write(out.status, out.body);
    }
    return write(404, { error: { code: 'NOT_FOUND', message: 'Endpoint tidak ditemukan.' } });
  });
}
