// Menyiapkan basis data: membuat database & tabel, mengisi paket Premium, membuat akun Admin.
// Pemakaian: npm run db:setup   (membaca .env)
import { loadConfig } from '../src/config.js';
import { createDb, mysqlSchemaSql } from '../src/db/index.js';
import { seedAdmin, seedPlans } from '../src/db/seed.js';

const config = loadConfig();

if (config.db.driver === 'mysql') {
  const mysql = (await import('mysql2/promise')).default;
  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    multipleStatements: true,
  });
  await conn.query(
    `CREATE DATABASE IF NOT EXISTS \`${config.db.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  await conn.query(`USE \`${config.db.database}\``);
  await conn.query(mysqlSchemaSql());
  await conn.end();
  console.log(`✔ Database "${config.db.database}" dan tabel siap.`);
}

const db = await createDb(config.db);
const plans = await seedPlans(db);
console.log(plans ? `✔ ${plans} paket Premium ditambahkan.` : '• Paket Premium sudah ada.');

const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
if (email && password) {
  const created = await seedAdmin(db, { nama: process.env.ADMIN_NAME || 'Admin NaraVisi', email, password });
  console.log(created ? `✔ Akun Admin ${email} dibuat.` : `• Akun ${email} sudah ada.`);
} else {
  console.log('• ADMIN_EMAIL/ADMIN_PASSWORD kosong — akun Admin tidak dibuat.');
}
await db.close();
