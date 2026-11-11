// NaraVisi · backend/src/server.js
// Fungsi   : Titik masuk server produksi: baca konfigurasi, siapkan DB, rangkai service, jalankan Express.
// Kebutuhan: semua RF (lewat routes.js)
// Terkait  : app.js, config.js, container.js, db/index.js

import { createApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { createServices } from './container.js';
import { createDb } from './db/index.js';
import { seedPlans } from './db/seed.js';
import { createAiClient } from './services/aiClient.js';

let config;
try {
  config = loadConfig();
} catch (err) {
  // Pesan jelas tanpa jejak tumpukan: apa yang salah dan cara memperbaikinya.
  console.error(`\nNaraVisi tidak dapat dijalankan (APP_ENV=${process.env.APP_ENV || 'development'}).`);
  console.error(err instanceof ConfigError ? err.message : `  - ${err.message}`);
  console.error('Perbaiki berkas backend/.env lalu jalankan ulang. Lihat backend/.env.example.\n');
  process.exit(1);
}
if (!process.env.JWT_SECRET) {
  console.warn(`PERINGATAN: JWT_SECRET kosong — memakai kunci pengembangan (NODE_ENV=${process.env.NODE_ENV}). Jangan dipakai orang lain.`);
}
const db = await createDb(config.db);
await seedPlans(db);

const aiClient = createAiClient({ baseUrl: config.aiServiceUrl, timeoutMs: config.aiTimeoutMs });
const services = createServices({ db, config, aiClient });
const app = createApp(services);

app.listen(config.port, () => {
  console.log(`Mode              : ${config.appEnv}`);
  console.log(`NaraVisi API      : ${config.publicUrl}/api/v1`);
  console.log(`Dashboard Admin   : ${config.publicUrl}/admin/`);
  console.log(`Basis data        : ${config.db.driver === 'mysql' ? `MySQL ${config.db.host}:${config.db.port}/${config.db.database}` : `SQLite ${config.db.sqlitePath}`}`);
  console.log(`Layanan AI        : ${config.aiServiceUrl}`);
  console.log(`Pembayaran        : ${services.payments.mode}`);
});
