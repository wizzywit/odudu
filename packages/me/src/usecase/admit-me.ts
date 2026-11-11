import { addressIssuer, type TenantAddress } from '@odudu/kernel';
import type { MeSessionLifespans } from '#/service/session-view';
import { agentMayAccess, mayAccess, requiredScope, type MeAccess } from '#/service/access';
import { insufficientScope, invalidToken, missingCredentials } from '#/service/challenge';
import { validateMeToken, type ValidateMeTokenDeps } from '#/usecase/validate-me-token';

export interface MeTenant {
  readonly id: string;
  readonly enabled: boolean;
  readonly lifespans: MeSessionLifespans;
  // How recent a sign-in a gated change needs, in seconds.
  readonly freshnessSeconds: number;
  // Whether the tenant lets a person change their own username.
  readonly usernameEditable: boolean;
}

export interface AdmitMeDeps extends ValidateMeTokenDeps {
  findTenant(name: string): Promise<MeTenant | null>;
  readonly logger: { warn(context: Record<string, unknown>, message: string): void };
}

export interface AdmitMeInput {
  readonly authorizationHeader: string | undefined;
  readonly tenantName: string;
  readonly address: TenantAddress;
  readonly now: Date;
}

// Who a request acts for: the token's own subject in the tenant it was issued
// for. Nothing a request carries names another.
export interface MeCaller {
  readonly tenantId: string;
  readonly subjectId: string;
  // The session the token was issued for, null when its grant has none.
  readonly sessionId: string | null;
  readonly lifespans: MeSessionLifespans;
  // The OAuth `client_id` the token was issued to.
  readonly clientId: string;
  // The tenant's current issuer, the one a logout token it queues names.
  readonly issuer: string;
  readonly freshnessSeconds: number;
  readonly usernameEditable: boolean;
}

export type MeAdmission =
  | { readonly kind: 'not_found' }
  | { readonly kind: 'unauthenticated'; readonly challenge: string }
  | { readonly kind: 'insufficient_scope'; readonly challenge: string }
  | { readonly kind: 'agent_not_permitted' }
  | { readonly kind: 'admitted'; readonly caller: MeCaller };

export function admitMeRead(deps: AdmitMeDeps, input: AdmitMeInput): Promise<MeAdmission> {
  return admitMe(deps, input, 'read');
}

export function admitMeWrite(deps: AdmitMeDeps, input: AdmitMeInput): Promise<MeAdmission> {
  return admitMe(deps, input, 'write');
}

// Whether a request may read or write, before anything it asks for is looked
// at. A tenant that is unknown and one that is disabled are answered alike.
async function admitMe(
  deps: AdmitMeDeps,
  input: AdmitMeInput,
  access: MeAccess,
): Promise<MeAdmission> {
  const tenant = await deps.findTenant(input.tenantName);
  if (tenant?.enabled !== true) return { kind: 'not_found' };

  const outcome = await validateMeToken(deps, {
    authorizationHeader: input.authorizationHeader,
    tenant: { id: tenant.id, name: input.tenantName },
    address: input.address,
    now: input.now,
  });
  if (outcome.kind === 'unauthenticated') {
    deps.logger.warn({ reason: outcome.reason }, 'me request unauthenticated');
    return {
      kind: 'unauthenticated',
      challenge: outcome.reason === 'missing_credentials' ? missingCredentials() : invalidToken(),
    };
  }
  if (!mayAccess(outcome.scopes, access)) {
    return { kind: 'insufficient_scope', challenge: insufficientScope(requiredScope(access)) };
  }
  if (!agentMayAccess(outcome.isAgent, access)) return { kind: 'agent_not_permitted' };
  return {
    kind: 'admitted',
    caller: {
      tenantId: tenant.id,
      subjectId: outcome.subjectId,
      sessionId: outcome.sessionId,
      lifespans: tenant.lifespans,
      freshnessSeconds: tenant.freshnessSeconds,
      usernameEditable: tenant.usernameEditable,
      clientId: outcome.clientId,
      issuer: addressIssuer(input.address),
    },
  };
}
