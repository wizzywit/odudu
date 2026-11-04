import {
  type Domain,
  type ListDomainsQuery,
  type PasskeyImpactResponse,
} from '@odudu/contracts/admin';
import { type TenantScopedDatabase } from '@odudu/db';
import { credentialRepository } from '@odudu/domain-identity';
import {
  canonicalHost,
  registerDomain,
  switchCanonical,
  tenantDomainRepository,
  verifyDomain,
  type DomainCode,
  type DomainRow,
  type ResolveTxt,
  type SwitchOutcome,
} from '@odudu/domain-tenant';
import { addressRelyingParty, baseRelyingPartyId, domainAddress } from '@odudu/kernel';
import { decodeCursor, encodeCursor, filterDigest } from '#/service/cursor';
import { domainWireShape, switchEtag } from '#/service/domain-wire';
import { type VerifyThrottle } from '#/service/domain-throttle';
import { matches } from '#/service/etag';
import { COUNT_CAP } from '#/usecase/counts';

const COLLECTION = 'domains';

export interface DomainAuditEvent {
  readonly action:
    | 'domain.registered'
    | 'domain.verified'
    | 'domain.activated'
    | 'domain.deactivated'
    | 'domain.removed'
    | 'domain.failed';
  readonly resourceType: 'domain';
  readonly resourceId: string;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
  readonly outcome: 'allowed' | 'refused' | 'failed';
  readonly detail?: Record<string, unknown>;
}

/** See `Audit` in `#/usecase/tenants.ts` — the same transactional write. */
export type Audit = (tx: TenantScopedDatabase, event: DomainAuditEvent) => Promise<void>;

export interface DomainsDeps {
  readonly audit: Audit;
  // The one resolver a verify looks a challenge up with, and the random
  // source a challenge is drawn from: both injected, so a test names them.
  readonly resolveTxt: ResolveTxt;
  readonly random: () => Buffer;
  // `ODUDU_PUBLIC_BASE_URL` and whether domains are served over https.
  readonly publicBaseUrl: string | undefined;
  readonly tls: boolean;
  readonly throttle: VerifyThrottle;
}

export interface DomainActor {
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

interface DomainTenant {
  readonly id: string;
  readonly name: string;
}

interface Pointed {
  readonly domain: Domain;
  readonly etag: string;
}

async function pointed(
  tx: TenantScopedDatabase,
  tenantId: string,
  row: DomainRow,
): Promise<Pointed> {
  const canonical = await tenantDomainRepository(tx).canonical(tenantId);
  return { domain: domainWireShape(row), etag: switchEtag(canonical) };
}

function audit(
  deps: DomainsDeps,
  tx: TenantScopedDatabase,
  actor: DomainActor,
  event: Pick<DomainAuditEvent, 'action' | 'resourceId' | 'outcome' | 'detail'>,
): Promise<void> {
  return deps.audit(tx, { ...event, resourceType: 'domain', ...actor });
}

export type RegisterOutcome =
  ({ kind: 'registered' } & Pointed) | { kind: 'refused'; code: DomainCode };

export async function registerDomainFor(
  tx: TenantScopedDatabase,
  deps: DomainsDeps,
  input: { tenant: DomainTenant; host: string } & DomainActor,
): Promise<RegisterOutcome> {
  const outcome = await registerDomain(
    {
      domains: tenantDomainRepository(tx),
      publicBaseUrl: deps.publicBaseUrl,
      random: deps.random,
    },
    input.tenant,
    input.host,
  );
  if (outcome.kind === 'refused') return outcome;
  await audit(deps, tx, input, {
    action: 'domain.registered',
    resourceId: outcome.row.id,
    outcome: 'allowed',
    detail: { host: outcome.row.host },
  });
  return { kind: 'registered', ...(await pointed(tx, input.tenant.id, outcome.row)) };
}

export type ListDomainsOutcome =
  | { kind: 'invalid_cursor' }
  | { kind: 'ok'; items: readonly Domain[]; next: string | null; etag: string };

export async function listDomains(
  tx: TenantScopedDatabase,
  input: ListDomainsQuery & {
    readonly limit: number;
    readonly cursorKey: Uint8Array;
    readonly tenantId: string;
  },
): Promise<ListDomainsOutcome> {
  const filters = filterDigest({});
  let after: string | undefined;
  if (input.cursor !== undefined) {
    const decoded = decodeCursor(
      input.cursorKey,
      COLLECTION,
      input.tenantId,
      filters,
      input.cursor,
    );
    if (decoded.kind === 'invalid') return { kind: 'invalid_cursor' };
    after = decoded.after;
  }
  const repository = tenantDomainRepository(tx);
  const rows = await repository.page(input.tenantId, { after, limit: input.limit + 1 });
  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;
  const last = page[page.length - 1];
  const next =
    hasMore && last !== undefined
      ? encodeCursor(input.cursorKey, {
          after: last.host,
          collection: COLLECTION,
          tenantId: input.tenantId,
          filters,
        })
      : null;
  const canonical = await repository.canonical(input.tenantId);
  return { kind: 'ok', items: page.map(domainWireShape), next, etag: switchEtag(canonical) };
}

export type ReadDomainOutcome = ({ kind: 'ok' } & Pointed) | { kind: 'not_found' };

export async function readDomain(
  tx: TenantScopedDatabase,
  input: { tenantId: string; id: string },
): Promise<ReadDomainOutcome> {
  const row = await tenantDomainRepository(tx).get(input.tenantId, input.id);
  if (row === null) return { kind: 'not_found' };
  return { kind: 'ok', ...(await pointed(tx, input.tenantId, row)) };
}

export type VerifyDomainOutcome =
  | ({ kind: 'ok' } & Pointed)
  | { kind: 'not_found' }
  | { kind: 'failed' }
  | { kind: 'verified_elsewhere' }
  | { kind: 'throttled'; retryAfterSeconds: number };

export async function verifyDomainFor(
  tx: TenantScopedDatabase,
  deps: DomainsDeps,
  input: { tenant: DomainTenant; id: string } & DomainActor,
  now: Date,
): Promise<VerifyDomainOutcome> {
  const repository = tenantDomainRepository(tx);
  const before = await repository.get(input.tenant.id, input.id);
  if (before === null) return { kind: 'not_found' };
  if (before.state === 'failed') return { kind: 'failed' };
  if (before.state === 'pending') {
    const decision = deps.throttle.take(input.tenant.id, before.host, now);
    if (!decision.allowed)
      return { kind: 'throttled', retryAfterSeconds: decision.retryAfterSeconds };
  }
  const outcome = await verifyDomain(
    { resolveTxt: deps.resolveTxt, domains: repository },
    input.tenant.id,
    input.id,
    now,
  );
  if (outcome === 'verified_elsewhere') {
    await audit(deps, tx, input, {
      action: 'domain.failed',
      resourceId: before.id,
      outcome: 'failed',
      detail: { host: before.host, reason: 'verified_elsewhere' },
    });
    return { kind: 'verified_elsewhere' };
  }
  if (outcome === 'verified' && before.state === 'pending') {
    await audit(deps, tx, input, {
      action: 'domain.verified',
      resourceId: before.id,
      outcome: 'allowed',
      detail: { host: before.host },
    });
  }
  const after = await repository.get(input.tenant.id, input.id);
  if (after === null) return { kind: 'not_found' };
  return { kind: 'ok', ...(await pointed(tx, input.tenant.id, after)) };
}

export type SwitchDomainOutcome =
  | ({ kind: 'ok' } & Pointed)
  | { kind: 'not_found' }
  | { kind: 'not_verified' }
  | { kind: 'no_base_url' }
  | { kind: 'conflict' }
  | { kind: 'precondition_failed' };

type Applied = Extract<SwitchOutcome, { kind: 'switched' | 'unchanged' }>;

function applied(outcome: SwitchOutcome): outcome is Applied {
  return outcome.kind === 'switched' || outcome.kind === 'unchanged';
}

function refusal(outcome: Exclude<SwitchOutcome, Applied>): SwitchDomainOutcome {
  return outcome.kind === 'not_verified' ? { kind: 'not_verified' } : { kind: outcome.kind };
}

export async function activateDomain(
  tx: TenantScopedDatabase,
  deps: DomainsDeps,
  input: { tenant: DomainTenant; id: string; ifMatch: string | undefined } & DomainActor,
  now: Date,
): Promise<SwitchDomainOutcome> {
  const outcome = await switchCanonical(
    { domains: tenantDomainRepository(tx), base: deps.publicBaseUrl, tls: deps.tls },
    input.tenant,
    input.id,
    now,
    { precondition: (current) => matches(input.ifMatch, switchEtag(current)) !== 'mismatch' },
  );
  if (!applied(outcome)) return refusal(outcome);
  if (outcome.kind === 'switched') {
    await audit(deps, tx, input, {
      action: 'domain.activated',
      resourceId: input.id,
      outcome: 'allowed',
      detail: { host: outcome.canonical?.host ?? null, previous: outcome.previous?.host ?? null },
    });
  }
  // Activating names a domain, so the address after it is that domain.
  if (outcome.canonical === null) return { kind: 'not_found' };
  return {
    kind: 'ok',
    domain: domainWireShape(outcome.canonical),
    etag: switchEtag(outcome.canonical),
  };
}

export async function deactivateDomain(
  tx: TenantScopedDatabase,
  deps: DomainsDeps,
  input: { tenant: DomainTenant; id: string; ifMatch: string | undefined } & DomainActor,
  now: Date,
): Promise<SwitchDomainOutcome> {
  const repository = tenantDomainRepository(tx);
  const row = await repository.get(input.tenant.id, input.id);
  if (row === null) return { kind: 'not_found' };
  // Not the tenant's address: there is nothing to give up, and switching to
  // the path address would take away whichever domain is.
  if (!row.canonical) return { kind: 'ok', ...(await pointed(tx, input.tenant.id, row)) };
  const outcome = await switchCanonical(
    { domains: repository, base: deps.publicBaseUrl, tls: deps.tls },
    input.tenant,
    'path',
    now,
    {
      precondition: (current) =>
        current?.id === row.id && matches(input.ifMatch, switchEtag(current)) !== 'mismatch',
    },
  );
  if (!applied(outcome)) return refusal(outcome);
  if (outcome.kind === 'switched') {
    await audit(deps, tx, input, {
      action: 'domain.deactivated',
      resourceId: row.id,
      outcome: 'allowed',
      detail: { host: row.host },
    });
  }
  const after = (await repository.get(input.tenant.id, input.id)) ?? row;
  return { kind: 'ok', domain: domainWireShape(after), etag: switchEtag(null) };
}

export type RemoveDomainOutcome =
  { kind: 'removed' } | { kind: 'not_found' } | { kind: 'canonical' };

export async function removeDomain(
  tx: TenantScopedDatabase,
  deps: DomainsDeps,
  input: { tenantId: string; id: string } & DomainActor,
): Promise<RemoveDomainOutcome> {
  const repository = tenantDomainRepository(tx);
  const row = await repository.get(input.tenantId, input.id);
  if (row === null) return { kind: 'not_found' };
  if (row.canonical) return { kind: 'canonical' };
  if (!(await repository.delete(input.tenantId, input.id))) return { kind: 'not_found' };
  await audit(deps, tx, input, {
    action: 'domain.removed',
    resourceId: row.id,
    outcome: 'allowed',
    detail: { host: row.host, state: row.state },
  });
  return { kind: 'removed' };
}

export type PasskeyImpactOutcome =
  ({ kind: 'ok' } & PasskeyImpactResponse) | { kind: 'invalid' } | { kind: 'not_found' };

// How many subjects a switch to `target` would hide a passkey from: those
// registered under another relying party ID than the target address uses.
export async function passkeyImpact(
  tx: TenantScopedDatabase,
  deps: Pick<DomainsDeps, 'publicBaseUrl' | 'tls'>,
  input: { tenantId: string; target: string },
): Promise<PasskeyImpactOutcome> {
  let rpId: string | null;
  if (input.target === 'path') {
    rpId = baseRelyingPartyId(deps.publicBaseUrl);
  } else {
    const host = canonicalHost(input.target);
    if (host === null) return { kind: 'invalid' };
    const row = await tenantDomainRepository(tx).getByHost(input.tenantId, host);
    if (row === null) return { kind: 'not_found' };
    rpId = addressRelyingParty(domainAddress(host, deps.tls)).id;
  }
  if (rpId === null) return { kind: 'ok', subjects: 0, capped: false };
  const counted = await credentialRepository(tx).subjectsWithPasskeyOutside(rpId, COUNT_CAP);
  return { kind: 'ok', ...counted };
}
