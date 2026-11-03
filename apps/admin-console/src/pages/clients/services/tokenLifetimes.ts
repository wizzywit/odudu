import { CLIENT_TOKEN_TTL_RANGES, type ClientTokenTtlField } from '@odudu/contracts/admin';
import { formatDuration } from '#/shared/services/format';
import { numberKept, rangeSentence } from '#/shared/services/numbers';

export interface Lifetime {
  field: ClientTokenTtlField;
  label: string;
  // What a client with no lifetime of its own takes.
  inherits: string;
  // The value a lifetime starts from when a client is given one.
  start: number;
}

export const LIFETIME_LABELS: Readonly<Record<ClientTokenTtlField, string>> = {
  access_token_ttl_seconds: 'Access token lifetime',
  id_token_ttl_seconds: 'ID token lifetime',
  refresh_token_ttl_seconds: 'Refresh token lifetime',
};

export const LIFETIMES: readonly Lifetime[] = [
  {
    field: 'access_token_ttl_seconds',
    label: LIFETIME_LABELS.access_token_ttl_seconds,
    inherits: "Takes the tenant's access token lifetime, set under Settings.",
    start: 3600,
  },
  {
    field: 'id_token_ttl_seconds',
    label: LIFETIME_LABELS.id_token_ttl_seconds,
    inherits: "Takes the tenant's ID token lifetime, set under Settings.",
    start: 3600,
  },
  {
    field: 'refresh_token_ttl_seconds',
    label: LIFETIME_LABELS.refresh_token_ttl_seconds,
    inherits: "Takes the tenant's refresh token lifetime, set under Settings.",
    start: 86_400,
  },
];

export function lifetimeBounds(field: ClientTokenTtlField): {
  min: number;
  max: number | undefined;
} {
  const { min, max } = CLIENT_TOKEN_TTL_RANGES[field];
  return { min, max };
}

// The range the server holds the lifetime to, with its human reading.
export function lifetimeRule(field: ClientTokenTtlField): string {
  const { min, max } = lifetimeBounds(field);
  return rangeSentence(min, max, formatDuration);
}

// Each toggle says which lifetime it hands back, so three are told apart.
export function tenantLifetimeLabel(label: string): string {
  return `Use the tenant's ${label.toLowerCase()}`;
}

export function lifetimeText(value: unknown): string {
  return typeof value === 'number' ? formatDuration(value) : "the tenant's lifetime";
}

// A duration a client may leave to a default, as a read-only page says it.
export function secondsReading(value: number | null, offText: string): string {
  return value === null ? offText : formatDuration(value);
}

// A number entered for a duration; cleared (NaN), the duration stays as it was.
export function keptSeconds(next: number | null, was: number | null): number | null {
  return next === null || was === null ? next : numberKept(next, was);
}
