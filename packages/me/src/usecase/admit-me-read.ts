import type { TenantAddress } from '@odudu/kernel';
import type { MeSessionLifespans } from '#/service/session-view';
import { insufficientScope, invalidToken, missingCredentials } from '#/service/challenge';
import { mayRead } from '#/service/read-access';
import { validateMeToken, type ValidateMeTokenDeps } from '#/usecase/validate-me-token';
import { ME_READ_SCOPE } from '@odudu/domain-tenant';

export interface MeTenant {
  readonly id: string;
  readonly enabled: boolean;
  readonly lifespans: MeSessionLifespans;
}

export interface AdmitMeReadDeps extends ValidateMeTokenDeps {
  findTenant(name: string): Promise<MeTenant | null>;
  readonly logger: { warn(context: Record<string, unknown>, message: string): void };
}

export interface AdmitMeReadInput {
  readonly authorizationHeader: string | undefined;
  readonly tenantName: string;
  readonly address: TenantAddress;
  readonly now: Date;
}

// Who a read acts for: the token's own subject in the tenant it was issued
// for. Nothing a request carries names another.
export interface MeCaller {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly sessionId: string | null;
  readonly lifespans: MeSessionLifespans;
}

export type MeAdmission =
  | { readonly kind: 'not_found' }
  | { readonly kind: 'unauthenticated'; readonly challenge: string }
  | { readonly kind: 'insufficient_scope'; readonly challenge: string }
  | { readonly kind: 'admitted'; readonly caller: MeCaller };

// Whether a request may read, before anything it asks for is looked at. A
// tenant that is unknown and one that is disabled are answered alike.
export async function admitMeRead(
  deps: AdmitMeReadDeps,
  input: AdmitMeReadInput,
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
  if (!mayRead(outcome.scopes)) {
    return { kind: 'insufficient_scope', challenge: insufficientScope(ME_READ_SCOPE) };
  }
  return {
    kind: 'admitted',
    caller: {
      tenantId: tenant.id,
      subjectId: outcome.subjectId,
      sessionId: outcome.sessionId,
      lifespans: tenant.lifespans,
    },
  };
}
