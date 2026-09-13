import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { OduduError } from '@odudu/kernel';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

function assertKek(kek: Uint8Array): void {
  if (kek.length !== 32) {
    throw new OduduError(
      'kek_invalid',
      `Key-encryption key must be 32 bytes, got ${String(kek.length)}`,
    );
  }
}

export function wrapPrivateJwk(jwk: unknown, kek: Uint8Array): string {
  assertKek(kek);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, kek, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(jwk), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

// T is a caller-asserted cast, not inferred from any argument — the same
// shape as JSON.parse's own typed overloads — so it is deliberately used
// only in the return position.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function unwrapPrivateJwk<T = unknown>(wrapped: string, kek: Uint8Array): T {
  assertKek(kek);
  const raw = Buffer.from(wrapped, 'base64');
  const decipher = createDecipheriv(ALGORITHM, kek, raw.subarray(0, IV_BYTES));
  decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  const plain = Buffer.concat([
    decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
    decipher.final(),
  ]);
  return JSON.parse(plain.toString('utf8')) as T;
}
