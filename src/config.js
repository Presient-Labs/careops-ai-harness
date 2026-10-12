import { dirname, join } from 'node:path';

export function loadConfig(env = process.env) {
  const dbPath = env.DB_PATH ?? './data/careops.db';
  const production = env.NODE_ENV === 'production';
  const publicHost = env.PUBLIC_HOST ?? 'localhost';
  return {
    port: Number(env.PORT ?? 3000),
    dbPath,
    directoryPath: env.DIRECTORY_PATH ?? join(dirname(dbPath), 'directory.db'),
    workplacesDir: env.WORKPLACES_DIR ?? join(dirname(dbPath), 'workplaces'),
    kbUrl: env.KB_URL ?? 'http://careops-kb:3838',
    kbApiKey: env.KB_API_KEY ?? '',
    openrouterKey: env.OPENROUTER_API_KEY ?? '',
    defaultModel: env.DEFAULT_MODEL ?? 'openai/gpt-5.4-mini',
    dailyBudgetUsd: Number(env.DAILY_BUDGET_USD ?? 3),
    chatIpLimit: Number(env.CHAT_IP_LIMIT ?? 60), // assistant turns per IP per 10 min (the demo password is public)
    demoPassword: env.DEMO_PASSWORD ?? 'careops-demo',
    secureCookies: production,
    totpKey: env.TOTP_KEY ?? '', // 32 random bytes, base64; encrypts authenticator secrets at rest
    publicHost, // the passkey relying-party id; never taken from a request's Host header
    publicOrigin: env.PUBLIC_ORIGIN ?? (production ? `https://${publicHost}` : 'http://localhost:3000'),
    privateWorkplaceCap: Number(env.PRIVATE_WORKPLACE_CAP ?? 200),
    creationsPerHour: Number(env.CREATIONS_PER_HOUR ?? 3),
    testClock: env.CAREOPS_TEST_CLOCK === '1' && !production, // the real-browser test's adjustable clock; never in production
  };
}
