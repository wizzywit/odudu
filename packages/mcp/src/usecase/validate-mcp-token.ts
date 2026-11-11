import {
  addressIssuer,
  mcpAudienceOfIssuer,
  namesMeAudience,
  type TenantAddress,
} from '@odudu/kernel';
import {
  checkGrantLiveness,
  resolveForeignIssuer,
  unverifiedIssuer,
  type AdminPrincipal,
  type AuthenticateAdminDeps,
  type ForeignIssuer,
} from '@odudu/protocol-admin';
import { extractBearerToken, MCP_READ_SCOPE, MCP_WRITE_SCOPE } from '@odudu/protocol-oidc';
import { mcpResourceUrl } from '#/service/resource';
import { validatedMcpToken, type ValidatedMcpToken } from '#/service/validated-token';

// The session lifespans a tenant's liveness is judged by, as the admin API's
// door takes them.
type SessionLifespans = Parameters<AuthenticateAdminDeps['isSessionLive']>[2];

export interface ValidateMcpTokenDeps extends AuthenticateAdminDeps {
  // The claims of an access token the tenant signed for `expected.audience`
  // under one of `expected.issuers`, or null for any reason it does not verify.
  verifyAccessToken(
    tenantId: string,
    token: string,
    expected: { readonly issuers: readonly string[]; readonly audience: string },
  ): Promise<Record<string, unknown> | null>;
}

export interface ValidateMcpTokenInput {
  readonly authorizationHeader: string | undefined;
  readonly tenant: {
    readonly id: string;
    readonly name: string;
    readonly lifespans: SessionLifespans;
  };
  // Where the tenant is served: the one address its resource URL, and so the
  // audience of every token it accepts, is made from.
  readonly address: TenantAddress;
  readonly issuerBase: string;
  readonly adminAudience: string;
  readonly now: Date;
}

export type McpAuthOutcome =
  | { readonly kind: 'valid'; readonly token: ValidatedMcpToken; readonly clientDbId: string }
  // `reason` is for the log only; a response never says which check refused.
  | {
      readonly kind: 'unauthenticated';
      readonly reason: string;
      readonly foreignIssuer?: ForeignIssuer;
      readonly foreignIssuerError?: unknown;
    }
  // A token that is valid in every way but carries no MCP scope.
  | { readonly kind: 'insufficient_scope'; readonly principal: AdminPrincipal };

function refused(reason: string): McpAuthOutcome {
  return { kind: 'unauthenticated', reason };
}

function audiencesOf(claim: unknown): readonly string[] {
  if (typeof claim === 'string') return [claim];
  return Array.isArray(claim) ? claim.filter((a): a is string => typeof a === 'string') : [];
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

// A genuine token of another tenant here (or of this tenant at an address it
// has left) is refused and recorded, as at the admin API's door; resolving it
// changes no answer.
async function foreignOutcome(
  deps: ValidateMcpTokenDeps,
  input: ValidateMcpTokenInput,
  token: string,
  iss: string,
): Promise<McpAuthOutcome> {
  try {
    const foreignIssuer = await resolveForeignIssuer(
      deps,
      { issuerBase: input.issuerBase, now: input.now },
      token,
      iss,
      mcpAudienceOfIssuer(iss),
    );
    return foreignIssuer === undefined
      ? refused('issuer_mismatch')
      : { kind: 'unauthenticated', reason: 'issuer_mismatch', foreignIssuer };
  } catch (foreignIssuerError) {
    return { kind: 'unauthenticated', reason: 'issuer_mismatch', foreignIssuerError };
  }
}

// What the MCP endpoint's door decides about a request's bearer token, in the
// order RFC 9068 §4 and RFC 6750 §3.1 give: the token is a JWT this tenant
// signed (`typ` `at+jwt`, issuer one the tenant accepts, unexpired) whose
// audience is the tenant's own MCP URL and not the admin API's, and what it
// stands on (grant, session, client, subject) is still there. Only the
// Authorization header is read. The result is a `ValidatedMcpToken` made from
// the verified claims, never from anything a tool or the request said.
export async function validateMcpToken(
  deps: ValidateMcpTokenDeps,
  input: ValidateMcpTokenInput,
): Promise<McpAuthOutcome> {
  const token = extractBearerToken(input.authorizationHeader);
  if (token === undefined) return refused('missing_credentials');
  const iss = unverifiedIssuer(token);
  if (iss === undefined) return refused('malformed_token');

  const { tenant } = input;
  const accepted = await deps.acceptedIssuers(
    { id: tenant.id, name: tenant.name },
    addressIssuer(input.address),
    input.now,
  );
  if (!accepted.includes(iss)) return foreignOutcome(deps, input, token, iss);

  const payload = await deps.verifyAccessToken(tenant.id, token, {
    issuers: accepted,
    audience: mcpResourceUrl(input.address),
  });
  if (payload === null) return refused('invalid_token');
  if (audiencesOf(payload.aud).includes(input.adminAudience)) return refused('admin_audience');
  if (namesMeAudience(payload.aud, accepted)) return refused('me_audience');

  const sub = nonEmpty(payload.sub);
  const clientId = nonEmpty(payload.client_id);
  const grantId = nonEmpty(payload.grant_id);
  const exp = payload.exp;
  if (
    sub === undefined ||
    clientId === undefined ||
    grantId === undefined ||
    typeof payload.scope !== 'string' ||
    typeof exp !== 'number'
  ) {
    return refused('invalid_token');
  }
  const scope = payload.scope.split(' ').filter((s) => s.length > 0);

  const live = await checkGrantLiveness(
    deps,
    { id: tenant.id, name: tenant.name, lifespans: tenant.lifespans },
    payload,
    sub,
    input.now,
  );
  if (live.kind === 'refused') return refused(live.reason);
  if (live.grant.subjectId !== sub) return refused('subject_mismatch');

  if (!scope.some((s) => s === MCP_READ_SCOPE || s === MCP_WRITE_SCOPE)) {
    return {
      kind: 'insufficient_scope',
      principal: {
        subjectId: sub,
        issuerTenantId: tenant.id,
        issuerTenantName: tenant.name,
        clientDbId: live.grant.clientId,
        scopes: scope,
      },
    };
  }
  return {
    kind: 'valid',
    clientDbId: live.grant.clientId,
    token: validatedMcpToken({
      tenant: { id: tenant.id, name: tenant.name },
      issuer: iss,
      subjectId: sub,
      clientId,
      grantId,
      scope,
      expSeconds: exp,
    }),
  };
}
