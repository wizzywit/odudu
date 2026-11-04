import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { type TenantScopedDatabase } from '@odudu/db';
import {
  canonicalHost,
  challengeName,
  DomainConflictError,
  registerDomain,
  switchCanonical,
  tenantDomainRepository,
  type DomainCode,
  type DomainRow,
} from '@odudu/domain-tenant';
import { OduduError } from '@odudu/kernel';
import { DOMAIN_OPTIONS } from '#/cli/seed-options';

export interface SeedDomainInput {
  tenant: string;
  host: string;
  canonical: boolean;
  assumeVerified: boolean;
}

export interface DomainCommandResult {
  command: 'domain';
  tenant: string;
  tenantId: string;
  host: string;
  state: DomainRow['state'];
  canonical: boolean;
  created: boolean;
  // Present until the domain is verified: the TXT record that proves it.
  recordName?: string;
  recordValue?: string;
}

export function parseSeedDomainArgs(argv: readonly string[], nodeEnv: string): SeedDomainInput {
  const { values } = parseArgs({ args: [...argv], options: DOMAIN_OPTIONS });
  if (values.tenant === undefined || values.host === undefined) {
    throw new OduduError('seed_invalid_options', 'seed domain requires --tenant and --host');
  }
  const assumeVerified = values['assume-verified'] === true;
  if (assumeVerified && nodeEnv === 'production') {
    throw new OduduError(
      'domain_assume_verified_production',
      '--assume-verified skips the DNS proof of ownership and is refused under ' +
        'NODE_ENV=production; publish the challenge record and verify the domain instead',
    );
  }
  return {
    tenant: values.tenant,
    host: values.host,
    canonical: values.canonical === true,
    assumeVerified,
  };
}

export interface SeedDomainContext {
  tenant: { id: string; name: string };
  publicBaseUrl: string | undefined;
  tls: boolean;
  now: Date;
}

const REFUSAL_SENTENCES: Record<DomainCode, (host: string) => string> = {
  domain_system_tenant: () => 'the system tenant cannot have domains',
  domain_no_base_url: () =>
    'ODUDU_PUBLIC_BASE_URL is required, because a domain is told apart from the operator host by it',
  domain_limit: () => 'the tenant already has as many domains as it may register',
  domain_already_registered: (host) => `${host} is already registered to this tenant`,
  domain_verified_elsewhere: (host) => `${host} is verified by another tenant`,
  domain_host_ip_literal: (host) => `${host} is an IP address, and a domain must be a DNS name`,
  domain_host_localhost: (host) => `${host} is a local name that no one else can reach`,
  domain_host_operator: (host) => `${host} is the operator's own host`,
  domain_host_reserved: (host) => `${host} is a reserved name that cannot be proven or served`,
  domain_host_invalid: (host) => `${host} is not a valid host name`,
};

export function domainRefusalMessage(code: DomainCode, host: string): string {
  return `${code}: ${REFUSAL_SENTENCES[code](host)}`;
}

function refused(code: DomainCode, host: string): OduduError {
  return new OduduError(
    code === 'domain_verified_elsewhere' || code === 'domain_already_registered'
      ? 'seed_conflict'
      : 'seed_invalid_options',
    domainRefusalMessage(code, host),
  );
}

// Runs inside the tenant's transaction, so a refusal at any step rolls back
// the registration made before it.
export async function seedDomainInTenant(
  tx: TenantScopedDatabase,
  context: SeedDomainContext,
  input: SeedDomainInput,
): Promise<DomainCommandResult> {
  const { tenant } = context;
  const domains = tenantDomainRepository(tx);
  const known = canonicalHost(input.host);
  let row = known === null ? null : await domains.getByHost(tenant.id, known);
  const created = row === null;
  if (row === null) {
    const outcome = await registerDomain(
      { domains, publicBaseUrl: context.publicBaseUrl, random: () => randomBytes(32) },
      tenant,
      input.host,
    );
    if (outcome.kind === 'refused') throw refused(outcome.code, input.host);
    row = outcome.row;
  }

  if (input.assumeVerified && row.state !== 'verified') {
    try {
      row = (await domains.markVerified(tenant.id, row.id, context.now)) ?? row;
    } catch (error) {
      if (error instanceof DomainConflictError && error.reason === 'host_verified_elsewhere') {
        throw refused('domain_verified_elsewhere', row.host);
      }
      throw error;
    }
  }

  if (input.canonical) {
    const outcome = await switchCanonical(
      { domains, base: context.publicBaseUrl, tls: context.tls },
      tenant,
      row.id,
      context.now,
    );
    if (outcome.kind === 'no_base_url') throw refused('domain_no_base_url', row.host);
    if (outcome.kind === 'not_verified') {
      throw new OduduError(
        'seed_conflict',
        `domain ${JSON.stringify(row.host)} is not verified (${outcome.state}), so it cannot be ` +
          'the canonical address; verify it first or pass --assume-verified',
      );
    }
    if (outcome.kind === 'not_found' || outcome.kind === 'conflict') {
      throw new OduduError(
        'seed_conflict',
        `domain ${JSON.stringify(row.host)} could not be made canonical: ${outcome.kind}`,
      );
    }
    row = (await domains.get(tenant.id, row.id)) ?? row;
  }

  return {
    command: 'domain',
    tenant: tenant.name,
    tenantId: tenant.id,
    host: row.host,
    state: row.state,
    canonical: row.canonical,
    created,
    ...(row.state === 'verified'
      ? {}
      : { recordName: challengeName(row.host), recordValue: row.challenge }),
  };
}
