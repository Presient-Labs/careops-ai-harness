import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// RFC 6238 authenticator codes: SHA-1, 6 digits, 30-second steps (what Google and Microsoft Authenticator use).
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const STEP_S = 30;

export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = ((value << 8) | byte) & 0xffff; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0, value = 0; const out = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('invalid base32');
    value = ((value << 5) | i) & 0xffff; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export function hotp(key, counter, digits = 6) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', key).update(msg).digest();
  const o = h[h.length - 1] & 0xf;
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export const stepAt = (ms) => Math.floor(ms / 1000 / STEP_S);
export const totpAt = (secretB32, ms, digits = 6) => hotp(base32Decode(secretB32), stepAt(ms), digits);

// The matched step, or null. Accepts the current step and one either side; a step at or before lastUsedStep is refused.
export function verifyTotp(secretB32, code, ms, lastUsedStep = 0) {
  const typed = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(typed)) return null;
  const key = base32Decode(secretB32); const now = stepAt(ms);
  for (const s of [now - 1, now, now + 1]) {
    if (s > lastUsedStep && timingSafeEqual(Buffer.from(hotp(key, s)), Buffer.from(typed))) return s;
  }
  return null;
}

export const generateTotpSecret = () => base32Encode(randomBytes(20));
export const otpauthUrl = ({ secret, account, issuer = 'CareOps Demo' }) =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
