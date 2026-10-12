import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// Authenticator secrets are stored encrypted (AES-256-GCM) under TOTP_KEY, so a copied database file alone cannot mint codes.
function keyOf(b64) {
  const k = Buffer.from(String(b64 ?? ''), 'base64');
  if (k.length !== 32) throw new Error('TOTP_KEY must be 32 bytes, base64-encoded');
  return k;
}
export function encryptSecret(plain, keyB64) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', keyOf(keyB64), iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `v1:${Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64')}`;
}
export function decryptSecret(enc, keyB64) {
  const [v, data] = String(enc).split(':');
  if (v !== 'v1' || !data) throw new Error('unknown secret format');
  const raw = Buffer.from(data, 'base64');
  const d = createDecipheriv('aes-256-gcm', keyOf(keyB64), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}
export const sha256Hex = (s) => createHash('sha256').update(String(s)).digest('hex');
