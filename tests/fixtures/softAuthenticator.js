import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';

// A software passkey for tests: a real P-256 key, "none" attestation, user presence and verification flags set.
const b64u = (b) => Buffer.from(b).toString('base64url');
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };

export function createSoftAuthenticator({ origin, rpID }) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const credId = randomBytes(16);
  const rpIdHash = createHash('sha256').update(rpID).digest();
  const cose = new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]);
  let counter = 0; let userHandle = null;
  const authData = (flags, attested) => Buffer.concat([rpIdHash, Buffer.from([flags]), u32(counter),
    ...(attested ? [Buffer.alloc(16), u16(credId.length), credId, Buffer.from(isoCBOR.encode(cose))] : [])]);
  const clientData = (type, challenge) => Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  return {
    register(options) {
      userHandle = options.user.id;
      const attestationObject = isoCBOR.encode(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData(0x45, true)]])); // UP|UV|AT
      return { id: b64u(credId), rawId: b64u(credId), type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform',
        response: { clientDataJSON: b64u(clientData('webauthn.create', options.challenge)), attestationObject: b64u(attestationObject), transports: ['internal'] } };
    },
    authenticate(options) {
      counter += 1;
      const cd = clientData('webauthn.get', options.challenge);
      const ad = authData(0x05, false); // UP|UV
      const signature = sign('sha256', Buffer.concat([ad, createHash('sha256').update(cd).digest()]), privateKey);
      return { id: b64u(credId), rawId: b64u(credId), type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform',
        response: { clientDataJSON: b64u(cd), authenticatorData: b64u(ad), signature: b64u(signature), userHandle } };
    },
  };
}
