import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createServices } from './container.js';
import { createDb } from './db/index.js';
import { seedPlans } from './db/seed.js';
import { createAiClient } from './services/aiClient.js';

const config = loadConfig();
if (!process.env.JWT_SECRET) {
  console.warn('PERINGATAN: JWT_SECRET kosong — memakai kunci pengembangan. Isi JWT_SECRET di .env sebelum dipakai orang lain.');
}
const db = await createDb(config.db);
await seedPlans(db);

const aiClient = createAiClient({ baseUrl: config.aiServiceUrl, timeoutMs: config.aiTimeoutMs });
const services = createServices({ db, config, aiClient });
const app = createApp(services);

app.listen(config.port, () => {
  console.log(`NaraVisi API      : ${config.publicUrl}/api/v1`);
  console.log(`Dashboard Admin   : ${config.publicUrl}/admin/`);
  console.log(`Basis data        : ${config.db.driver === 'mysql' ? `MySQL ${config.db.host}:${config.db.port}/${config.db.database}` : `SQLite ${config.db.sqlitePath}`}`);
  console.log(`Layanan AI        : ${config.aiServiceUrl}`);
  console.log(`Pembayaran        : ${services.payments.mode}`);
});
