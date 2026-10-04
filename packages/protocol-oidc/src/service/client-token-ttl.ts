export type ClientTokenTtlField =
  'access_token_ttl_seconds' | 'id_token_ttl_seconds' | 'refresh_token_ttl_seconds';

export interface ClientTokenTtlRange {
  readonly min: number;
  /** Omitted, the column's own integer ceiling. */
  readonly max?: number;
}

// client_oidc_config_access_token_ttl_ceiling (0013_access_token_ttl_ceiling.sql),
// client_oidc_config_id_token_ttl_ceiling (0082_tenant_lifetimes.sql) and
// client_oidc_config_refresh_token_ttl_floor (0014_refresh_token_ttl_floor.sql),
// restated so a caller is refused before the write; protocol-admin's
// client-ttl-check.int.test.ts holds the two in agreement.
export const CLIENT_TOKEN_TTL_RANGES: Readonly<Record<ClientTokenTtlField, ClientTokenTtlRange>> = {
  access_token_ttl_seconds: { min: 1, max: 3600 },
  id_token_ttl_seconds: { min: 1, max: 3600 },
  refresh_token_ttl_seconds: { min: 1 },
};

// PostgreSQL `integer`: a larger value fails as out of range, not a CHECK.
const INTEGER_CEILING = 2_147_483_647;

export function clientTokenTtlProblem(field: ClientTokenTtlField, value: number): string | null {
  const { min, max = INTEGER_CEILING } = CLIENT_TOKEN_TTL_RANGES[field];
  return value < min || value > max
    ? `${field} must be between ${String(min)} and ${String(max)}`
    : null;
}

export interface TokenLifetimes {
  readonly accessTokenTtlSeconds: number;
  readonly idTokenTtlSeconds: number;
  readonly refreshTokenTtlSeconds: number;
}

export interface ClientTokenLifetimes {
  readonly accessTokenTtlSeconds: number | null;
  readonly idTokenTtlSeconds: number | null;
  readonly refreshTokenTtlSeconds: number | null;
}

/** A client's own lifetime where it has one, the tenant's where it does not. */
export function effectiveLifetimes(
  client: ClientTokenLifetimes,
  tenant: TokenLifetimes,
): TokenLifetimes {
  return {
    accessTokenTtlSeconds: client.accessTokenTtlSeconds ?? tenant.accessTokenTtlSeconds,
    idTokenTtlSeconds: client.idTokenTtlSeconds ?? tenant.idTokenTtlSeconds,
    refreshTokenTtlSeconds: client.refreshTokenTtlSeconds ?? tenant.refreshTokenTtlSeconds,
  };
}
