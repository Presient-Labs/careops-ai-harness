import { openDirectory } from './db/directory.js';
import { startCleanup } from './workplaces/cleanup.js';
import { loadConfig } from './config.js';
import { openDb } from './db/index.js';
import { seedDb } from './db/seed.js';
import { createApp } from './app.js';
import { createKbClient } from './retrieval/kbClient.js';
import { OpenRouterProvider } from './llm/openrouter.js';
import { systemClock } from './util/clock.js';

const config = loadConfig();
if (process.env.NODE_ENV === 'production' && Buffer.from(config.totpKey, 'base64').length !== 32) {
  console.error(JSON.stringify({ msg: 'TOTP_KEY must be 32 random bytes, base64-encoded (openssl rand -base64 32)' }));
  process.exit(1);
}
const db = openDb(config.dbPath);
if (db.prepare('SELECT COUNT(*) n FROM users').get().n === 0) seedDb(db, { clock: systemClock, demoPassword: config.demoPassword });
const directory = openDirectory(config.directoryPath, systemClock);
const kb = createKbClient({ baseUrl: config.kbUrl, apiKey: config.kbApiKey });
const provider = new OpenRouterProvider({ apiKey: config.openrouterKey });
const { app, pool } = createApp({ db, directory, kb, provider, clock: systemClock, config });
startCleanup({ directory, pool, dir: config.workplacesDir, clock: systemClock });
app.listen(config.port, () => console.log(JSON.stringify({ msg: 'careops listening', port: config.port })));
