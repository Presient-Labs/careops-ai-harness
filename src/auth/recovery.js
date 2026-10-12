import { randomInt } from 'node:crypto';
import { sha256Hex } from './secrets.js';

// No 0/o, 1/l/i: recovery codes are read off a screen and typed back.
const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789';
export const normalizeCode = (c) => String(c ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
export function generateRecoveryCodes(n = 10) {
  const codes = new Set();
  while (codes.size < n) codes.add(Array.from({ length: 10 }, () => ALPHA[randomInt(ALPHA.length)]).join(''));
  return [...codes];
}
export const hashRecoveryCode = (c) => sha256Hex(normalizeCode(c));
