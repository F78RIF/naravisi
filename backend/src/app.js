import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { dispatch, errorResult } from './http/dispatch.js';
import { buildRoutes } from './http/routes.js';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');

function send(res, out) {
  res.status(out.status);
  if (out.html !== undefined) return res.type('html').send(out.html);
  return res.json(out.body);
}

/** Aplikasi Express 5 (SRS 2.4). Semua rute berasal dari http/routes.js. */
export function createApp(services) {
  const { config } = services;
  const app = express();
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');
    if (req.path.startsWith('/api/')) {
      // Extension memanggil dari service worker (host_permissions); header ini untuk uji dari web.
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Headers', 'content-type, authorization');
      res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      if (req.method === 'OPTIONS') return res.sendStatus(204);
    }
    next();
  });

  const jsonLimit = Math.ceil((config.maxImageBytes * 4) / 3) + 64 * 1024;
  app.use(express.json({ limit: jsonLimit }));
  app.use(express.urlencoded({ extended: false, limit: '16kb' }));

  for (const route of buildRoutes(services)) {
    app[route.method.toLowerCase()](route.path, async (req, res) => {
      const out = await dispatch(
        route,
        { params: req.params, query: req.query, body: req.body ?? {}, headers: req.headers },
        services,
      );
      send(res, out);
    });
  }

  // Dashboard Admin (RF-21, RF-22, RF-27..30) — halaman statis yang memanggil REST API.
  app.get('/admin', (req, res) => res.redirect('/admin/'));
  app.use('/admin', express.static(path.join(publicDir, 'admin'), { index: 'index.html' }));

  app.use((req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint tidak ditemukan.' } });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: { code: 'IMAGE_TOO_LARGE', message: 'Ukuran permintaan terlalu besar.' } });
    }
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Badan permintaan bukan JSON yang valid.' } });
    }
    return send(res, errorResult(err));
  });

  return app;
}
