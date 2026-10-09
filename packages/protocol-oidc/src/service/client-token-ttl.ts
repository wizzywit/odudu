import {
  CLIENT_TOKEN_TTL_RANGES,
  INTEGER_CEILING,
  type ClientTokenTtlField,
  type ClientTokenTtlRange,
} from '@odudu/contracts/admin';

// The ranges are stated in @odudu/contracts so a console offers the same
// bounds. They restate the CHECK constraints client_oidc_config_access_token_ttl_ceiling
// (0013), client_oidc_config_id_token_ttl_ceiling (0082) and
// client_oidc_config_refresh_token_ttl_floor (0014), which protocol-admin's
// client-ttl-check.int.test.ts holds them to.
export { CLIENT_TOKEN_TTL_RANGES, type ClientTokenTtlField, type ClientTokenTtlRange };

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
