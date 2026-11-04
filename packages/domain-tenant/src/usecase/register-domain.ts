import { DomainConflictError, type DomainRow, type NewDomain } from '#/repository/tenant-domains';
import { SYSTEM_TENANT_ID } from '#/service/admin-capabilities';
import {
  canonicalHost,
  challengeName,
  DOMAIN_CODES,
  newChallenge,
  REFUSAL_CODES,
  refuseHost,
  type DomainCode,
} from '#/service/tenant-domain';

export interface RegisterDomainDeps {
  domains: { insert(input: NewDomain): Promise<DomainRow> };
  publicBaseUrl: string | undefined;
  random: () => Buffer;
}

export type RegisterDomainOutcome =
  | { kind: 'registered'; row: DomainRow; recordName: string; recordValue: string }
  | { kind: 'refused'; code: DomainCode };

const refused = (code: DomainCode): RegisterDomainOutcome => ({ kind: 'refused', code });

const CONFLICT_CODES = {
  limit: DOMAIN_CODES.limit,
  already_registered: DOMAIN_CODES.alreadyRegistered,
  host_verified_elsewhere: DOMAIN_CODES.verifiedElsewhere,
} as const;

export async function registerDomain(
  deps: RegisterDomainDeps,
  tenant: { id: string; name: string },
  rawHost: string,
): Promise<RegisterDomainOutcome> {
  if (tenant.id === SYSTEM_TENANT_ID) return refused(DOMAIN_CODES.systemTenant);
  if (deps.publicBaseUrl === undefined) return refused(DOMAIN_CODES.noBaseUrl);
  const operatorHost = new URL(deps.publicBaseUrl).hostname;
  const refusal = refuseHost(rawHost, operatorHost);
  if (refusal !== null) return refused(REFUSAL_CODES[refusal]);
  const host = canonicalHost(rawHost);
  if (host === null)
    throw new Error(`a host refuseHost accepted has no canonical form: ${rawHost}`);
  try {
    const row = await deps.domains.insert({
      tenantId: tenant.id,
      host,
      challenge: newChallenge(deps.random),
    });
    return {
      kind: 'registered',
      row,
      recordName: challengeName(host),
      recordValue: row.challenge,
    };
  } catch (error) {
    if (error instanceof DomainConflictError) return refused(CONFLICT_CODES[error.reason]);
    throw error;
  }
}
