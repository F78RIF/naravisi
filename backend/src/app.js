import express from 'express';
import { AppError } from './lib/errors.js';
import { createDescriptionService } from './services/descriptionService.js';

/**
 * Membuat aplikasi Express. Dependensi disuntikkan agar dapat diuji.
 */
export function createApp({ aiClient, maxImageBytes }) {
  const app = express();
  const descriptions = createDescriptionService({ aiClient, maxImageBytes });

  app.disable('x-powered-by');

  // Extension memanggil API dari service worker (host_permissions), sehingga
  // CORS tidak wajib. Header ini memudahkan uji dari halaman web/devtools.
  app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'content-type, authorization');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // Base64 ~ 4/3 ukuran asli, ditambah ruang untuk field lain.
  const jsonLimit = Math.ceil((maxImageBytes * 4) / 3) + 64 * 1024;
  app.use(express.json({ limit: jsonLimit }));

  const api = express.Router();

  api.get('/health', async (req, res) => {
    const ai = await aiClient.health();
    res.json({ status: 'ok', ai });
  });

  // RF-09, RF-10, RF-11
  api.post('/descriptions', async (req, res) => {
    const result = await descriptions.describe(req.body);
    res.status(201).json(result);
  });

  app.use('/api/v1', api);

  app.use((req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint tidak ditemukan.' } });
  });

  // Express 5 meneruskan error dari handler async ke sini secara otomatis.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof AppError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message } });
    }
    if (err?.type === 'entity.too.large') {
      return res
        .status(413)
        .json({ error: { code: 'IMAGE_TOO_LARGE', message: 'Ukuran permintaan terlalu besar.' } });
    }
    if (err?.type === 'entity.parse.failed') {
      return res
        .status(400)
        .json({ error: { code: 'INVALID_REQUEST', message: 'Badan permintaan bukan JSON yang valid.' } });
    }
    console.error(err);
    return res
      .status(500)
      .json({ error: { code: 'INTERNAL', message: 'Terjadi kesalahan pada server.' } });
  });

  return app;
}
