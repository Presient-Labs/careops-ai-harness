import { randomBytes } from 'node:crypto';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';

// Passkeys (WebAuthn). User verification is required, so a passkey proves both the device and the person.
// The relying party id and origin come from configuration, never from the request.
export const CHALLENGE_TTL_MS = 5 * 60_000;

function saveChallenge(directory, { challenge, accountId = null, purpose, now }) {
  const id = randomBytes(24).toString('base64url');
  directory.prepare('INSERT INTO webauthn_challenges (id, challenge, account_id, purpose, expires_at) VALUES (?,?,?,?,?)').run(id, challenge, accountId, purpose, now + CHALLENGE_TTL_MS);
  return id;
}
function takeChallenge(directory, id, purpose, now) {
  const r = directory.prepare('SELECT * FROM webauthn_challenges WHERE id = ? AND purpose = ?').get(String(id ?? ''), purpose);
  if (!r) return null;
  directory.prepare('DELETE FROM webauthn_challenges WHERE id = ?').run(r.id);
  return r.expires_at > now ? r : null;
}

export async function startRegistration({ directory, config, clock, account }) {
  const existing = directory.prepare('SELECT id, transports FROM passkeys WHERE account_id = ?').all(account.id);
  const options = await generateRegistrationOptions({
    rpName: 'CareOps Demo', rpID: config.publicHost, userName: account.username, userID: Buffer.from(account.id), attestationType: 'none',
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    excludeCredentials: existing.map(p => ({ id: p.id, transports: JSON.parse(p.transports) })),
  });
  return { options, challengeId: saveChallenge(directory, { challenge: options.challenge, accountId: account.id, purpose: 'register', now: clock.now().getTime() }) };
}

export async function finishRegistration({ directory, config, clock, account, challengeId, response }) {
  const ch = takeChallenge(directory, challengeId, 'register', clock.now().getTime());
  if (!ch || ch.account_id !== account.id) return false;
  let v;
  try { v = await verifyRegistrationResponse({ response, expectedChallenge: ch.challenge, expectedOrigin: config.publicOrigin, expectedRPID: config.publicHost, requireUserVerification: true }); }
  catch { return false; }
  if (!v.verified || !v.registrationInfo) return false;
  const { credential } = v.registrationInfo;
  directory.prepare('INSERT INTO passkeys (id, account_id, public_key, counter, transports, created_at) VALUES (?,?,?,?,?,?)')
    .run(credential.id, account.id, Buffer.from(credential.publicKey).toString('base64url'), credential.counter, JSON.stringify(credential.transports ?? []), clock.now().getTime());
  return true;
}

export async function startLogin({ directory, config, clock }) {
  const options = await generateAuthenticationOptions({ rpID: config.publicHost, userVerification: 'required', allowCredentials: [] });
  return { options, challengeId: saveChallenge(directory, { challenge: options.challenge, purpose: 'login', now: clock.now().getTime() }) };
}

export async function finishLogin({ directory, config, clock, challengeId, response }) {
  const ch = takeChallenge(directory, challengeId, 'login', clock.now().getTime());
  if (!ch) return null;
  const pk = directory.prepare('SELECT * FROM passkeys WHERE id = ?').get(String(response?.id ?? ''));
  if (!pk) return null;
  let v;
  try {
    v = await verifyAuthenticationResponse({ response, expectedChallenge: ch.challenge, expectedOrigin: config.publicOrigin, expectedRPID: config.publicHost, requireUserVerification: true,
      credential: { id: pk.id, publicKey: Buffer.from(pk.public_key, 'base64url'), counter: pk.counter, transports: JSON.parse(pk.transports) } });
  } catch { return null; }
  if (!v.verified) return null;
  directory.prepare('UPDATE passkeys SET counter = ? WHERE id = ?').run(v.authenticationInfo.newCounter, pk.id);
  return pk.account_id;
}
