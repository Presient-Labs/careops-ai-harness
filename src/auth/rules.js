import { readFileSync } from 'node:fs';

const COMMON = new Set(readFileSync(new URL('./common-passwords.txt', import.meta.url), 'utf8')
  .split(/\r?\n/).map(s => s.trim().toLowerCase()).filter(Boolean));
// Persona usernames exist inside every workplace copy, so a visitor cannot take one.
export const RESERVED_USERNAMES = new Set(['priya', 'jordan', 'sam', 'marcus', 'dana', 'admin', 'root', 'system']);

export function usernameProblem(u) {
  if (typeof u !== 'string' || !/^[A-Za-z0-9_]{3,32}$/.test(u)) return 'Usernames are 3 to 32 letters, numbers or underscores.';
  if (RESERVED_USERNAMES.has(u.toLowerCase())) return 'That username is reserved. Pick another.';
  return null;
}

export function passwordProblem(p) {
  if (typeof p !== 'string' || p.length < 12) return 'Use at least 12 characters.';
  if (p.length > 200) return 'Use at most 200 characters.';
  if (COMMON.has(p.toLowerCase())) return 'That password is too common. Pick another.';
  return null;
}
