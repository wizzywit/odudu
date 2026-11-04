import {
  isUniqueViolation,
  tenants,
  withSavepoint,
  type Database,
  type TenantScopedDatabase,
} from '@odudu/db';
import { and, asc, count, eq, gt, isNotNull, max, ne, or, sql } from 'drizzle-orm';
import { hostServes } from '#/service/tenant-domain';
import { tenantDomains, tenantIssuerRetirements, type DomainState } from '#/schema/tenant-domains';

// Rows a tenant may hold in any state, so its list is one bounded read.
export const MAX_DOMAINS_PER_TENANT = 20;

// Retirements a tenant's read returns at most; a switch writes one, and each
// leaves the list when its window closes.
const MAX_RETIRED_READ = 100;

export interface DomainRow {
  id: string;
  tenantId: string;
  host: string;
  state: DomainState;
  challenge: string;
  verifiedAt: Date | null;
  lastCheckedAt: Date | null;
  failedChecks: number;
  canonical: boolean;
}

export interface NewDomain {
  tenantId: string;
  host: string;
  challenge: string;
  id?: string;
}

export interface RetiredIssuer {
  issuer: string;
  expiresAt: Date;
}

export interface HostRoute {
  tenantId: string;
  tenantName: string;
  canonical: boolean;
  retiredUntil: Date | null;
}

export type DomainConflict = 'limit' | 'already_registered' | 'host_verified_elsewhere';

/**
 * The repository's refusal a usecase maps to a stable code: the tenant holds
 * the most rows it may, holds this host already, or another tenant verified
 * the host first.
 */
export class DomainConflictError extends Error {
  readonly reason: DomainConflict;

  constructor(reason: DomainConflict, subject: string) {
    super(`domain ${JSON.stringify(subject)}: ${reason}`);
    this.name = 'DomainConflictError';
    this.reason = reason;
  }
}

const COLUMNS = {
  id: tenantDomains.id,
  tenantId: tenantDomains.tenantId,
  host: tenantDomains.host,
  state: tenantDomains.state,
  challenge: tenantDomains.challenge,
  verifiedAt: tenantDomains.verifiedAt,
  lastCheckedAt: tenantDomains.lastCheckedAt,
  failedChecks: tenantDomains.failedChecks,
  canonical: tenantDomains.canonical,
};

function lockTenantDomains(tx: TenantScopedDatabase, tenantId: string) {
  return tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`tenant_domains:${tenantId}`}, 0))`,
  );
}

export function tenantDomainRepository(tx: TenantScopedDatabase) {
  const own = (tenantId: string, id: string) =>
    and(eq(tenantDomains.tenantId, tenantId), eq(tenantDomains.id, id));

  return {
    async insert(input: NewDomain): Promise<DomainRow> {
      await lockTenantDomains(tx, input.tenantId);
      const [held] = await tx
        .select({ n: count() })
        .from(tenantDomains)
        .where(eq(tenantDomains.tenantId, input.tenantId));
      if ((held?.n ?? 0) >= MAX_DOMAINS_PER_TENANT) {
        throw new DomainConflictError('limit', input.host);
      }
      try {
        return await withSavepoint(tx, async (inner) => {
          const rows = await inner
            .insert(tenantDomains)
            .values({
              id: input.id ?? crypto.randomUUID(),
              tenantId: input.tenantId,
              host: input.host,
              challenge: input.challenge,
            })
            .returning(COLUMNS);
          const row = rows[0];
          if (row === undefined) throw new Error('insert into tenant_domains returned no row');
          return row;
        });
      } catch (error) {
        if (isUniqueViolation(error))
          throw new DomainConflictError('already_registered', input.host);
        throw error;
      }
    },

    list(tenantId: string): Promise<DomainRow[]> {
      return tx
        .select(COLUMNS)
        .from(tenantDomains)
        .where(eq(tenantDomains.tenantId, tenantId))
        .orderBy(asc(tenantDomains.createdAt), asc(tenantDomains.id))
        .limit(MAX_DOMAINS_PER_TENANT);
    },

    async get(tenantId: string, id: string): Promise<DomainRow | null> {
      const rows = await tx.select(COLUMNS).from(tenantDomains).where(own(tenantId, id));
      return rows[0] ?? null;
    },

    async getByHost(tenantId: string, host: string): Promise<DomainRow | null> {
      const rows = await tx
        .select(COLUMNS)
        .from(tenantDomains)
        .where(and(eq(tenantDomains.tenantId, tenantId), eq(tenantDomains.host, host)));
      return rows[0] ?? null;
    },

    async delete(tenantId: string, id: string): Promise<boolean> {
      const rows = await tx
        .delete(tenantDomains)
        .where(own(tenantId, id))
        .returning({ id: tenantDomains.id });
      return rows.length > 0;
    },

    // The first tenant to verify a host holds it: the partial unique index
    // refuses the second.
    async markVerified(tenantId: string, id: string, now: Date): Promise<DomainRow | null> {
      try {
        return await withSavepoint(tx, async (inner) => {
          const rows = await inner
            .update(tenantDomains)
            .set({ state: 'verified', verifiedAt: now, lastCheckedAt: now, failedChecks: 0 })
            .where(own(tenantId, id))
            .returning(COLUMNS);
          return rows[0] ?? null;
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new DomainConflictError('host_verified_elsewhere', id);
        }
        throw error;
      }
    },

    // A row that fails is no longer anybody's canonical address: the CHECK
    // allows canonical only on a verified one.
    async markFailed(tenantId: string, id: string): Promise<DomainRow | null> {
      const rows = await tx
        .update(tenantDomains)
        .set({ state: 'failed', canonical: false })
        .where(own(tenantId, id))
        .returning(COLUMNS);
      return rows[0] ?? null;
    },

    async recordCheck(
      tenantId: string,
      id: string,
      passed: boolean,
      now: Date,
    ): Promise<DomainRow | null> {
      const rows = await tx
        .update(tenantDomains)
        .set({
          lastCheckedAt: now,
          failedChecks: passed ? 0 : sql`${tenantDomains.failedChecks} + 1`,
        })
        .where(own(tenantId, id))
        .returning(COLUMNS);
      return rows[0] ?? null;
    },

    // Makes a verified row the tenant's one canonical host. Null when the row
    // is not the tenant's or is not verified, with nothing changed.
    async setCanonical(tenantId: string, id: string): Promise<DomainRow | null> {
      await lockTenantDomains(tx, tenantId);
      const target = await tx
        .select({ id: tenantDomains.id })
        .from(tenantDomains)
        .where(and(own(tenantId, id), eq(tenantDomains.state, 'verified')));
      if (target[0] === undefined) return null;
      await tx
        .update(tenantDomains)
        .set({ canonical: false })
        .where(
          and(
            eq(tenantDomains.tenantId, tenantId),
            eq(tenantDomains.canonical, true),
            ne(tenantDomains.id, id),
          ),
        );
      const rows = await tx
        .update(tenantDomains)
        .set({ canonical: true })
        .where(own(tenantId, id))
        .returning(COLUMNS);
      return rows[0] ?? null;
    },

    async clearCanonical(tenantId: string): Promise<number> {
      const rows = await tx
        .update(tenantDomains)
        .set({ canonical: false })
        .where(and(eq(tenantDomains.tenantId, tenantId), eq(tenantDomains.canonical, true)))
        .returning({ id: tenantDomains.id });
      return rows.length;
    },

    // A second retirement of one issuer keeps the later expiry, so a switch
    // back and forth inside a window never shortens what an earlier one gave.
    async retireIssuer(tenantId: string, issuer: string, expiresAt: Date): Promise<void> {
      await tx
        .insert(tenantIssuerRetirements)
        .values({ tenantId, issuer, expiresAt })
        .onConflictDoUpdate({
          target: [tenantIssuerRetirements.tenantId, tenantIssuerRetirements.issuer],
          set: {
            expiresAt: sql`greatest(${tenantIssuerRetirements.expiresAt}, excluded.expires_at)`,
          },
        });
    },

    async clearRetirement(tenantId: string, issuer: string): Promise<boolean> {
      const rows = await tx
        .delete(tenantIssuerRetirements)
        .where(
          and(
            eq(tenantIssuerRetirements.tenantId, tenantId),
            eq(tenantIssuerRetirements.issuer, issuer),
          ),
        )
        .returning({ issuer: tenantIssuerRetirements.issuer });
      return rows.length > 0;
    },

    listRetired(tenantId: string, now: Date): Promise<RetiredIssuer[]> {
      return tx
        .select({
          issuer: tenantIssuerRetirements.issuer,
          expiresAt: tenantIssuerRetirements.expiresAt,
        })
        .from(tenantIssuerRetirements)
        .where(
          and(
            eq(tenantIssuerRetirements.tenantId, tenantId),
            gt(tenantIssuerRetirements.expiresAt, now),
          ),
        )
        .orderBy(asc(tenantIssuerRetirements.issuer))
        .limit(MAX_RETIRED_READ);
    },
  };
}

/** The host a tenant's canonical address names, or null for the path address. */
export async function canonicalHostOf(
  tx: TenantScopedDatabase,
  tenantId: string,
): Promise<string | null> {
  const rows = await tx
    .select({ host: tenantDomains.host })
    .from(tenantDomains)
    .where(
      and(
        eq(tenantDomains.tenantId, tenantId),
        eq(tenantDomains.canonical, true),
        eq(tenantDomains.state, 'verified'),
      ),
    );
  return rows[0]?.host ?? null;
}

// Which tenant a request for `host` belongs to, before any tenant context
// exists to read through. `db` must be the owner connection, as
// tenantLookupRepository's is (ADR 0009's amendment of 2026-09-13): the
// serving role reads no row of either table here. Only what routing needs
// leaves: a verified host of an enabled tenant that is its canonical address
// or an issuer it retired inside the window it is still accepted for.
export async function lookupHost(db: Database, host: string, now: Date): Promise<HostRoute | null> {
  const retired = db
    .select({ until: max(tenantIssuerRetirements.expiresAt).as('until') })
    .from(tenantIssuerRetirements)
    .where(
      and(
        eq(tenantIssuerRetirements.tenantId, tenantDomains.tenantId),
        sql`${tenantIssuerRetirements.issuer} in (${`https://${host}`}, ${`http://${host}`})`,
        gt(tenantIssuerRetirements.expiresAt, now),
      ),
    )
    .as('retired');
  const rows = await db
    .select({
      tenantId: tenantDomains.tenantId,
      tenantName: tenants.name,
      canonical: tenantDomains.canonical,
      retiredUntil: retired.until,
    })
    .from(tenantDomains)
    .innerJoin(tenants, eq(tenants.id, tenantDomains.tenantId))
    .leftJoinLateral(retired, sql`true`)
    .where(
      and(
        eq(tenantDomains.host, host),
        eq(tenantDomains.state, 'verified'),
        eq(tenants.enabled, true),
        or(eq(tenantDomains.canonical, true), isNotNull(retired.until)),
      ),
    );
  return rows[0] ?? null;
}

export type HostState =
  { kind: 'live'; route: HostRoute } | { kind: 'not_live' } | { kind: 'unknown' };

interface HostFacts {
  tenant_id: string | null;
  tenant_name: string | null;
  enabled: boolean | null;
  canonical: boolean | null;
  retired_until: Date | string | null;
  registered: boolean;
}

// What a request for `host` is, on the same owner connection as lookupHost,
// in one statement: the verified row with its tenant and open retirement
// window, and whether any row at all names the host. Served (live),
// registered by some tenant but not serving (a pending, failed or idle row,
// or a disabled tenant) or nobody's; nothing of a tenant leaves unless live.
export async function hostState(db: Database, host: string, now: Date): Promise<HostState> {
  const rows = await db.execute<HostFacts & Record<string, unknown>>(sql`
    select v.tenant_id, v.tenant_name, v.enabled, v.canonical, v.retired_until,
           (v.tenant_id is not null
            or exists (select 1 from tenant_domains where host = ${host} and state <> 'verified')
           ) as registered
      from (select 1) as one
      left join lateral (
        select td.tenant_id, t.name as tenant_name, t.enabled, td.canonical,
               (select max(r.expires_at) from tenant_issuer_retirements r
                 where r.tenant_id = td.tenant_id
                   and r.issuer in (${`https://${host}`}, ${`http://${host}`})
                   and r.expires_at > ${now.toISOString()}::timestamptz) as retired_until
          from tenant_domains td
          join tenants t on t.id = td.tenant_id
         where td.host = ${host} and td.state = 'verified'
      ) v on true
  `);
  const facts = rows[0];
  if (!facts?.registered) return { kind: 'unknown' };
  const retiredUntil = facts.retired_until === null ? null : new Date(facts.retired_until);
  if (
    facts.tenant_id === null ||
    facts.tenant_name === null ||
    !hostServes({
      enabled: facts.enabled === true,
      canonical: facts.canonical === true,
      retiredUntil,
    })
  ) {
    return { kind: 'not_live' };
  }
  return {
    kind: 'live',
    route: {
      tenantId: facts.tenant_id,
      tenantName: facts.tenant_name,
      canonical: facts.canonical === true,
      retiredUntil,
    },
  };
}
