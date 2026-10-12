CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS workplaces (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('shared','private')),
  created_at INTEGER NOT NULL, expires_at INTEGER);
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL,
  workplace_id TEXT NOT NULL REFERENCES workplaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('employee','manager','billing','admin')),
  password_hash TEXT NOT NULL, failed_count INTEGER NOT NULL DEFAULT 0, locked_until INTEGER,
  email_enabled_at INTEGER, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS totp_credentials (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE, secret_enc TEXT NOT NULL,
  last_used_step INTEGER NOT NULL DEFAULT 0, confirmed_at INTEGER, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS recovery_codes (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, code_hash TEXT NOT NULL, used_at INTEGER,
  PRIMARY KEY (account_id, code_hash));
CREATE TABLE IF NOT EXISTS passkeys (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL, counter INTEGER NOT NULL DEFAULT 0, transports TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS email_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL, purpose TEXT NOT NULL CHECK (purpose IN ('signin','enable')),
  expires_at INTEGER NOT NULL, used_at INTEGER, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS mailbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  subject TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  workplace_id TEXT NOT NULL REFERENCES workplaces(id) ON DELETE CASCADE, user_id TEXT NOT NULL,
  csrf TEXT NOT NULL, stage TEXT NOT NULL CHECK (stage IN ('halfway','full')),
  created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id TEXT PRIMARY KEY, challenge TEXT NOT NULL, account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('register','login')), expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS creation_log (ip_key TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS security_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, kind TEXT NOT NULL, detail_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS llm_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, day TEXT NOT NULL, model TEXT NOT NULL, purpose TEXT NOT NULL,
  cost_usd REAL NOT NULL, tokens_in INTEGER, tokens_out INTEGER, latency_ms INTEGER, ok INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS lab_results (lab TEXT PRIMARY KEY, at TEXT NOT NULL, results_json TEXT NOT NULL);
