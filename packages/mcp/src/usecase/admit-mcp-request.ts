import { type TenantAddress } from '@odudu/kernel';
import { lifespansOf, type AdminPrincipal, type ForeignIssuer } from '@odudu/protocol-admin';
import { MCP_READ_SCOPE } from '@odudu/protocol-oidc';
import { challengeFor, insufficientScope, invalidToken } from '#/service/challenge';
import type { McpLogger } from '#/service/deps';
import type { McpPrincipal, McpRequestInfo } from '#/service/endpoint';
import { hostAccepted, originAccepted } from '#/service/origin-policy';
import type { ToolLimiter } from '#/service/rate-limit';
import { validateMcpToken, type ValidateMcpTokenDeps } from '#/usecase/validate-mcp-token';

// The rows a refusal leaves, written by the server that holds the database.
export interface McpRefusalAudit {
  foreignIssuer(tenantId: string, foreign: ForeignIssuer, request: McpRequestInfo): Promise<void>;
  agentWithoutScope(
    tenantId: string,
    principal: AdminPrincipal,
    request: McpRequestInfo,
  ): Promise<void>;
}

export interface AdmitDeps {
  readonly auth: ValidateMcpTokenDeps;
  readonly adminAudience: string;
  // Whether the deployment states its public address.
  readonly addressConfigured: boolean;
  readonly limiter: ToolLimiter;
  readonly audit: McpRefusalAudit;
  readonly now: () => Date;
  readonly newRequestId: () => string;
  readonly logger: Pick<McpLogger, 'error'> & {
    warn(context: Record<string, unknown>, message: string): void;
  };
}

export interface AdmitInput {
  readonly host: string | undefined;
  readonly origin: string | undefined;
  readonly authorization: string | undefined;
  readonly tenantName: string;
  readonly address: TenantAddress;
  readonly issuerBase: string;
  readonly ip: string;
}

// What the route answers. `requestId` is generated for every request that gets
// past the tenant, and is the one the answer, the audit rows and the admin
// call carry.
export type Admitted =
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'unauthenticated'; readonly requestId: string; readonly challenge: string }
  | { readonly kind: 'insufficient_scope'; readonly requestId: string; readonly challenge: string }
  | {
      readonly kind: 'rate_limited';
      readonly requestId: string;
      readonly retryAfterSeconds: number;
    }
  | {
      readonly kind: 'admitted';
      readonly requestId: string;
      readonly principal: McpPrincipal;
      readonly info: McpRequestInfo;
      readonly release: () => void;
    };

async function recorded(deps: AdmitDeps, what: string, write: () => Promise<void>): Promise<void> {
  try {
    await write();
  } catch (error) {
    deps.logger.error({ err: error }, `could not record ${what}`);
  }
}

// Everything a request must pass before its body is read, in the order the
// answer may not depend on: the host and origin it came to (which need no
// lookup), whether the tenant is served at all (answered as the protected
// resource metadata is, with nothing to tell an unknown tenant from a disabled
// one), then the token and the principal's budgets.
export async function admitMcpRequest(deps: AdmitDeps, input: AdmitInput): Promise<Admitted> {
  const { address } = input;
  const configured = deps.addressConfigured;
  if (!hostAccepted(input.host, address, configured)) return { kind: 'forbidden' };
  if (!originAccepted(input.origin, address, configured)) return { kind: 'forbidden' };

  const tenant = await deps.auth.findTenant(input.tenantName);
  if (tenant?.enabled !== true) return { kind: 'not_found' };

  const info: McpRequestInfo = { requestId: deps.newRequestId(), ip: input.ip };
  const outcome = await validateMcpToken(deps.auth, {
    authorizationHeader: input.authorization,
    tenant: { id: tenant.id, name: input.tenantName, lifespans: lifespansOf(tenant) },
    address,
    issuerBase: input.issuerBase,
    adminAudience: deps.adminAudience,
    now: deps.now(),
  });

  if (outcome.kind === 'unauthenticated') {
    if (outcome.foreignIssuerError !== undefined) {
      deps.logger.error({ err: outcome.foreignIssuerError }, 'could not resolve a refused issuer');
    } else if (outcome.foreignIssuer !== undefined) {
      const foreign = outcome.foreignIssuer;
      await recorded(deps, 'a foreign issuer', () =>
        deps.audit.foreignIssuer(tenant.id, foreign, info),
      );
    } else {
      deps.logger.warn({ reason: outcome.reason }, 'mcp request unauthenticated');
    }
    return {
      kind: 'unauthenticated',
      requestId: info.requestId,
      challenge:
        outcome.reason === 'missing_credentials'
          ? challengeFor(address, MCP_READ_SCOPE)
          : invalidToken(address, MCP_READ_SCOPE),
    };
  }
  if (outcome.kind === 'insufficient_scope') {
    await recorded(deps, 'a token without an MCP scope', () =>
      deps.audit.agentWithoutScope(tenant.id, outcome.principal, info),
    );
    return {
      kind: 'insufficient_scope',
      requestId: info.requestId,
      challenge: insufficientScope(address, [MCP_READ_SCOPE]),
    };
  }

  const { token, clientDbId } = outcome;
  const budget = deps.limiter.admit(token.tenant.id, token.subjectId, token.clientId);
  if (!budget.admitted) {
    return {
      kind: 'rate_limited',
      requestId: info.requestId,
      retryAfterSeconds: budget.retryAfterSeconds,
    };
  }
  return {
    kind: 'admitted',
    requestId: info.requestId,
    principal: { token, clientDbId },
    info,
    release: budget.release,
  };
}
