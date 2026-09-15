import { z } from 'zod';

// password and totp: one per subject (partial unique index, migration
// 0034). webauthn and recovery-code: many. password-history: retired
// hashes kept for the realm's password-history depth, never verified
// against for login. Declared here, not in the schema, so this service
// stays a leaf that nothing but zod depends on — the schema imports it
// instead of the other way around.
export type CredentialType =
  'password' | 'totp' | 'webauthn' | 'recovery-code' | 'password-history';

const passwordShape = z.strictObject({ hash: z.string() });
const totpShape = z.strictObject({
  secret: z.string(),
  digits: z.number().int(),
  lastStep: z.number().int(),
});
const webauthnShape = z.strictObject({
  publicKey: z.string(),
  counter: z.number().int(),
  transports: z.array(z.string()),
});
const recoveryCodeShape = z.strictObject({ hash: z.string() });
const passwordHistoryShape = z.strictObject({ hash: z.string() });

export type CredentialSecret =
  | ({ kind: 'password' } & z.infer<typeof passwordShape>)
  | ({ kind: 'totp' } & z.infer<typeof totpShape>)
  | ({ kind: 'webauthn' } & z.infer<typeof webauthnShape>)
  | ({ kind: 'recovery-code' } & z.infer<typeof recoveryCodeShape>)
  | ({ kind: 'password-history' } & z.infer<typeof passwordHistoryShape>);

// secret_data is jsonb: unknown in, one of the shapes above out. A value
// that does not match its column's type — a stale row, a hand-edited one —
// throws here rather than being narrowed loosely. Overloaded on a literal
// `type` so a caller that already knows which credential type it read (e.g.
// passwordFor, always 'password') gets that variant back typed, not the
// full union.
export function parseCredentialSecret(
  type: 'password',
  value: unknown,
): Extract<CredentialSecret, { kind: 'password' }>;
export function parseCredentialSecret(
  type: 'totp',
  value: unknown,
): Extract<CredentialSecret, { kind: 'totp' }>;
export function parseCredentialSecret(
  type: 'webauthn',
  value: unknown,
): Extract<CredentialSecret, { kind: 'webauthn' }>;
export function parseCredentialSecret(
  type: 'recovery-code',
  value: unknown,
): Extract<CredentialSecret, { kind: 'recovery-code' }>;
export function parseCredentialSecret(
  type: 'password-history',
  value: unknown,
): Extract<CredentialSecret, { kind: 'password-history' }>;
export function parseCredentialSecret(type: CredentialType, value: unknown): CredentialSecret;
export function parseCredentialSecret(type: CredentialType, value: unknown): CredentialSecret {
  switch (type) {
    case 'password':
      return { kind: 'password', ...parse(type, passwordShape, value) };
    case 'totp':
      return { kind: 'totp', ...parse(type, totpShape, value) };
    case 'webauthn':
      return { kind: 'webauthn', ...parse(type, webauthnShape, value) };
    case 'recovery-code':
      return { kind: 'recovery-code', ...parse(type, recoveryCodeShape, value) };
    case 'password-history':
      return { kind: 'password-history', ...parse(type, passwordHistoryShape, value) };
  }
}

function parse<Shape extends z.ZodType>(
  type: CredentialType,
  shape: Shape,
  value: unknown,
): z.infer<Shape> {
  const result = shape.safeParse(value);
  if (!result.success) {
    throw new Error(`invalid credential secret for type "${type}": ${result.error.message}`);
  }
  return result.data;
}

// The inverse of parseCredentialSecret: what the repository writes into
// secret_data. "kind" carries no information secret_data doesn't already
// get from the type column, and leaving it out keeps every shape above
// (all declared with strictObject) matching rows written before this type
// existed, none of which have a "kind" field either.
export function serializeCredentialSecret(secret: CredentialSecret): unknown {
  switch (secret.kind) {
    case 'password':
    case 'recovery-code':
    case 'password-history':
      return { hash: secret.hash };
    case 'totp':
      return { secret: secret.secret, digits: secret.digits, lastStep: secret.lastStep };
    case 'webauthn':
      return {
        publicKey: secret.publicKey,
        counter: secret.counter,
        transports: secret.transports,
      };
  }
}
