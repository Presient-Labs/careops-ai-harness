import test from 'node:test';
import assert from 'node:assert/strict';
import { base32Encode, base32Decode, hotp, stepAt, totpAt, verifyTotp, generateTotpSecret, otpauthUrl } from '../src/auth/totp.js';
import { encryptSecret, decryptSecret, sha256Hex } from '../src/auth/secrets.js';
import { generateRecoveryCodes, normalizeCode, hashRecoveryCode } from '../src/auth/recovery.js';
import { qrDataUrl } from '../src/auth/qr.js';

const RFC_KEY = Buffer.from('12345678901234567890');
const KEY = Buffer.alloc(32, 7).toString('base64');

test('RFC 6238 Appendix B, SHA-1, 8 digits', () => {
  const vectors = [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']];
  for (const [t, code] of vectors) assert.equal(hotp(RFC_KEY, Math.floor(t / 30), 8), code, `T=${t}`);
});

test('base32 round trip and the RFC 4648 example', () => {
  assert.equal(base32Encode(Buffer.from('foobar')), 'MZXW6YTBOI');
  assert.deepEqual(base32Decode('mzxw6ytboi'), Buffer.from('foobar'));
  const secret = generateTotpSecret();
  assert.equal(secret.length, 32);
  assert.equal(base32Decode(secret).length, 20);
});

test('verifyTotp accepts the current step and one either side, and returns the step', () => {
  const secret = base32Encode(RFC_KEY);
  const t = 1_111_111_111_000;
  assert.equal(verifyTotp(secret, totpAt(secret, t), t), stepAt(t));
  assert.equal(verifyTotp(secret, totpAt(secret, t - 30_000), t), stepAt(t) - 1);
  assert.equal(verifyTotp(secret, totpAt(secret, t + 30_000), t), stepAt(t) + 1);
  assert.equal(verifyTotp(secret, totpAt(secret, t - 60_000), t), null);
});

test('a code at or before the last used step is refused (each code works once)', () => {
  const secret = base32Encode(RFC_KEY);
  const t = 1_111_111_111_000;
  assert.equal(verifyTotp(secret, totpAt(secret, t), t, stepAt(t)), null);
  assert.equal(verifyTotp(secret, totpAt(secret, t + 30_000), t, stepAt(t)), stepAt(t) + 1);
});

test('a code typed with spaces verifies', () => {
  const secret = base32Encode(RFC_KEY);
  const t = 1_111_111_111_000;
  const code = totpAt(secret, t);
  assert.equal(verifyTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`, t), stepAt(t));
});

test('malformed codes are refused without throwing', () => {
  const secret = base32Encode(RFC_KEY);
  for (const bad of ['', '12345', '1234567', 'abcdef', null, undefined]) assert.equal(verifyTotp(secret, bad, 0), null);
});

test('otpauth URL names the issuer and account', () => {
  assert.equal(otpauthUrl({ secret: 'ABC', account: 'alice' }), 'otpauth://totp/CareOps%20Demo:alice?secret=ABC&issuer=CareOps%20Demo&algorithm=SHA1&digits=6&period=30');
});

test('secrets round trip under AES-256-GCM; a wrong key or tampering fails', () => {
  const enc = encryptSecret('JBSWY3DPEHPK3PXP', KEY);
  assert.match(enc, /^v1:/);
  assert.notEqual(encryptSecret('JBSWY3DPEHPK3PXP', KEY), enc);
  assert.equal(decryptSecret(enc, KEY), 'JBSWY3DPEHPK3PXP');
  assert.throws(() => decryptSecret(enc, Buffer.alloc(32, 8).toString('base64')));
  const raw = Buffer.from(enc.slice(3), 'base64'); raw[raw.length - 1] ^= 1;
  assert.throws(() => decryptSecret(`v1:${raw.toString('base64')}`, KEY));
  assert.throws(() => encryptSecret('x', 'short'), /32 bytes/);
});

test('recovery codes: 10 distinct 10-character codes; hashing ignores case, spaces and dashes', () => {
  const codes = generateRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  for (const c of codes) assert.match(c, /^[abcdefghjkmnpqrstuvwxyz23456789]{10}$/);
  assert.equal(normalizeCode('AbCdE-fGhJk '), 'abcdefghjk');
  assert.equal(hashRecoveryCode('abcde-fghjk'), sha256Hex('abcdefghjk'));
});

test('qrDataUrl returns an SVG data URL', () => {
  const url = qrDataUrl('otpauth://totp/x?secret=ABC');
  assert.match(url, /^data:image\/svg\+xml;base64,/);
  assert.match(Buffer.from(url.split(',')[1], 'base64').toString('utf8'), /<svg/);
});
