import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createAiClient } from './services/aiClient.js';

const config = loadConfig();
const aiClient = createAiClient({ baseUrl: config.aiServiceUrl, timeoutMs: config.aiTimeoutMs });
const app = createApp({ aiClient, maxImageBytes: config.maxImageBytes });

app.listen(config.port, () => {
  console.log(`NaraVisi API berjalan di http://localhost:${config.port}/api/v1`);
  console.log(`Layanan AI: ${config.aiServiceUrl}`);
});
