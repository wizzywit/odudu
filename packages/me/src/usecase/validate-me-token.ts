import { addressIssuer, addressUrl, ME_RESOURCE_PATH, type TenantAddress } from '@odudu/kernel';
import {
  extractBearerToken,
  unverifiedIssuer,
  type AcceptedIssuersLookup,
} from '@odudu/protocol-oidc';
import { audienceIsMeOrIssuer, meTokenClaims, type MeTokenClaims } from '#/service/me-token';

export interface ValidateMeTokenDeps {
  // The issuers a token for this tenant may carry: its canonical address and
  // any it left whose window is open.
  acceptedIssuers: AcceptedIssuersLookup;
  // The claims of an access token the tenant signed for `expected.audience`
  // under one of `expected.issuers`, or null for any reason it does not verify.
  verifyAccessToken(
    tenantId: string,
    token: string,
    expected: { readonly issuers: readonly string[]; readonly audience: string },
  ): Promise<Record<string, unknown> | null>;
}

export interface ValidateMeTokenInput {
  readonly authorizationHeader: string | undefined;
  readonly tenant: { readonly id: string; readonly name: string };
  readonly address: TenantAddress;
  readonly now: Date;
}

export type MeAuthOutcome =
  | ({ readonly kind: 'ok'; readonly tenantId: string } & MeTokenClaims)
  // `reason` is for the log only; a response never says which check refused.
  | { readonly kind: 'unauthenticated'; readonly reason: string };

function refused(reason: string): MeAuthOutcome {
  return { kind: 'unauthenticated', reason };
}

// The door of the "me" API: a JWT this tenant signed (`typ` `at+jwt`, an issuer
// it accepts, unexpired) whose audience is the tenant's own "me" URL, with at
// most the issuer beside it.
// Session and grant liveness are not checked here.
export async function validateMeToken(
  deps: ValidateMeTokenDeps,
  input: ValidateMeTokenInput,
): Promise<MeAuthOutcome> {
  const token = extractBearerToken(input.authorizationHeader);
  if (token === undefined) return refused('missing_credentials');
  const iss = unverifiedIssuer(token);
  if (iss === undefined) return refused('malformed_token');

  const { tenant } = input;
  const accepted = await deps.acceptedIssuers(tenant, addressIssuer(input.address), input.now);
  if (!accepted.includes(iss)) return refused('issuer_mismatch');

  const audience = addressUrl(input.address, ME_RESOURCE_PATH);
  const payload = await deps.verifyAccessToken(tenant.id, token, {
    issuers: accepted,
    audience,
  });
  if (payload === null) return refused('invalid_token');
  if (!audienceIsMeOrIssuer(payload.aud, audience, iss)) return refused('invalid_token');

  const claims = meTokenClaims(payload);
  if (claims === null) return refused('invalid_token');
  return { kind: 'ok', tenantId: tenant.id, ...claims };
}
