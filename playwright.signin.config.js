import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// A throwaway local server with the adjustable clock; never the shared demo.
const data = mkdtempSync(join(tmpdir(), 'careops-e2e-'));
const PORT = 3107;
export default defineConfig({
  testDir: './e2e',
  testMatch: 'signin.spec.js',
  timeout: 90_000,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, viewport: { width: 1280, height: 860 }, trace: 'retain-on-failure' },
  webServer: {
    command: 'node src/main.js',
    url: `http://localhost:${PORT}/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: { PORT: String(PORT), DB_PATH: join(data, 'careops.db'), CAREOPS_TEST_CLOCK: '1', TOTP_KEY: Buffer.alloc(32, 9).toString('base64'),
      PUBLIC_HOST: 'localhost', PUBLIC_ORIGIN: `http://localhost:${PORT}`, OPENROUTER_API_KEY: '', KB_URL: 'http://127.0.0.1:9', KB_API_KEY: 'e2e', CREATIONS_PER_HOUR: '50' },
  },
});
