import { formatAbsolute, counted, groupedNumber } from '#/shared/services/format';
import { type CreateOutcome, createFailure, refusedBy } from '#/shared/services/failure';
import type { GatewayFailure } from '#/shared/services/result';

export interface MintValues {
  uses: number;
  ttl_seconds: number;
}

export const MINT_LIMITS = {
  uses: { min: 1, max: 2_147_483_647 },
  ttl_seconds: { min: 60, max: 31_536_000 },
} as const;

export const DEFAULT_MINT: MintValues = { uses: 1, ttl_seconds: 3600 };

export const MINT_FIELDS = ['uses', 'ttl_seconds'] as const;

export type MintErrors = Partial<Record<(typeof MINT_FIELDS)[number], string>>;

const USES_RULE = `Uses is a whole number from ${groupedNumber(MINT_LIMITS.uses.min)} to ${groupedNumber(MINT_LIMITS.uses.max)}.`;
const TTL_RULE = `Lifetime is a whole number of seconds, from ${String(MINT_LIMITS.ttl_seconds.min)} seconds (1 minute) to ${String(MINT_LIMITS.ttl_seconds.max)} seconds (365 days).`;

function inRange(value: number, limit: { min: number; max: number }): boolean {
  return Number.isInteger(value) && value >= limit.min && value <= limit.max;
}

export function mintProblems(values: MintValues): MintErrors {
  return {
    ...(inRange(values.uses, MINT_LIMITS.uses) ? {} : { uses: USES_RULE }),
    ...(inRange(values.ttl_seconds, MINT_LIMITS.ttl_seconds) ? {} : { ttl_seconds: TTL_RULE }),
  };
}

const LOST =
  'The token may have been created, but the answer could not be read, so it cannot be shown. Look at the list: revoke any token you did not receive, then mint another.';

export function mintFailure(failure: GatewayFailure): CreateOutcome {
  return createFailure(failure, {
    noun: 'registration token',
    name: 'the token',
    fields: MINT_FIELDS,
    capability: 'manage-clients',
    schema: LOST,
    refused: refusedBy('manage-clients'),
  });
}

export function mintedText(token: { remaining_uses: number; expires_at: string }): string {
  return `Registration token minted: ${counted(token.remaining_uses, 'use', 'uses')}, until ${formatAbsolute(new Date(token.expires_at))}.`;
}

export function isValid(errors: MintErrors): boolean {
  return Object.keys(errors).length === 0;
}
