import { exportJWK, generateKeyPair, jwtVerify, type JWK, type JWTPayload, importJWK } from 'jose';

export interface TestKey {
  privateKey: JWK;
  publicKey: JWK;
}

export async function testKey(alg: string): Promise<TestKey> {
  const pair = await generateKeyPair(alg, { extractable: true });
  return {
    privateKey: await exportJWK(pair.privateKey),
    publicKey: await exportJWK(pair.publicKey),
  };
}

export interface VerifiedAssertion {
  header: { alg: string; kid?: string };
  payload: JWTPayload;
}

// Checks a client assertion's signature with the public half of the key and
// its issuer and audience, as the server does.
export async function verifyAssertion(
  assertion: string,
  publicKey: JWK,
  expected: { clientId: string; audience: string; now: number },
  alg: string,
): Promise<VerifiedAssertion> {
  const key = await importJWK(publicKey, alg);
  const { payload, protectedHeader } = await jwtVerify(assertion, key, {
    issuer: expected.clientId,
    subject: expected.clientId,
    audience: expected.audience,
    algorithms: [alg],
    currentDate: new Date(expected.now),
  });
  return { header: protectedHeader, payload };
}
