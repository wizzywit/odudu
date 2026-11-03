import { signingKeyAlgSchema, type SigningKeyAlg } from '@odudu/contracts/admin';
import { createFailure, type CreateOutcome } from '#/shared/lib/services/failure';
import type { GatewayFailure } from '#/shared/lib/services/result';

export const DEFAULT_ALG: SigningKeyAlg = 'ES256';

export const ALG_OPTIONS: readonly { id: SigningKeyAlg; label: string }[] = [
  { id: 'ES256', label: 'ES256 (elliptic curve)' },
  { id: 'RS256', label: 'RS256 (RSA)' },
];

export const STAGE_RULE =
  'A staged key is published in the key set at once and signs nothing until you promote it, which gives relying parties time to fetch it first.';

export function defaultAlg(active: { alg: SigningKeyAlg } | undefined): SigningKeyAlg {
  return active?.alg ?? DEFAULT_ALG;
}

export function algOf(value: string): SigningKeyAlg {
  const parsed = signingKeyAlgSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_ALG;
}

export function stagedText(key: { alg: string; kid: string }): string {
  return `An ${key.alg} key, ${key.kid}, was staged. It is published but does not sign until you promote it.`;
}

export function stageFailure(failure: GatewayFailure): CreateOutcome {
  return createFailure(failure, {
    noun: 'signing key',
    name: 'The key',
    fields: ['alg'],
    capability: 'manage-keys',
  });
}
