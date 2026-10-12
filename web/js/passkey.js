// Passkeys through the browser's own WebAuthn JSON helpers (no library on the page).
const unsupported = () => new Error('This browser cannot use passkeys here. Use an authenticator app or emailed codes instead.');

export async function createPasskey(options) {
  if (!window.PublicKeyCredential?.parseCreationOptionsFromJSON) throw unsupported();
  const credential = await navigator.credentials.create({ publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(options) });
  return credential.toJSON();
}

export async function getPasskey(options) {
  if (!window.PublicKeyCredential?.parseRequestOptionsFromJSON) throw unsupported();
  const credential = await navigator.credentials.get({ publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options) });
  return credential.toJSON();
}

export const passkeyError = (e) => (e?.name === 'NotAllowedError'
  ? 'The passkey request was cancelled or timed out.'
  : e?.message ?? 'The passkey did not work. Try another method.');

// The whole passkey sign-in: options, the device prompt, verification. Returns the API result or { error }.
export async function signInWithPasskey(api) {
  const start = await api('/auth/passkeys/login/options', { method: 'POST' });
  if (start.error) return start;
  let response;
  try { response = await getPasskey(start.options); } catch (e) { return { error: { message: passkeyError(e) } }; }
  return api('/auth/passkeys/login/verify', { method: 'POST', body: { challengeId: start.challengeId, response } });
}
