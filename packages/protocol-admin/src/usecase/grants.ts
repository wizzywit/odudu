import { type TenantScopedDatabase } from '@odudu/db';
import { subjectRepository } from '@odudu/domain-identity';
import { clientRepository, clients } from '@odudu/domain-tenant';
import { refreshTokens, tokenGrantRepository, tokenGrants } from '@odudu/protocol-oidc';
import { and, asc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { isBeyond, isNotBeyond, subjectsBeyond } from '#/service/capability-ceiling';
import { BULK_WRITE_LIMIT } from '#/usecase/bulk-limit';
import { countAtMost } from '#/usecase/capped-count';
import { refuseOverServiceAccountCeiling } from '#/usecase/clients';
import { idPage, resumeAfter, type IdPageOutcome } from '#/usecase/id-page';
import {
  lockSubjectRow,
  refuseOverTargetCeiling,
  type TargetCeilingInput,
  type TargetCeilingRefusal,
} from '#/usecase/subjects';

export interface GrantView {
  readonly id: string;
  readonly clientDbId: string;
  readonly clientKey: string;
  readonly scope: string;
  readonly createdAt: Date;
  readonly sessionId: string | null;
  readonly refreshExpiresAt: Date | null;
}

export interface ListGrantsInput {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly now: Date;
  readonly limit: number;
  readonly cursor: string | undefined;
  readonly cursorKey: Uint8Array;
}

export type ListGrantsOutcome = { kind: 'not_found' } | IdPageOutcome<GrantView>;

// Not revoked, whatever else is true of it: a grant nothing has revoked is
// one a refresh token or an access token can still be presented under.
export async function listSubjectGrants(
  tx: TenantScopedDatabase,
  input: ListGrantsInput,
): Promise<ListGrantsOutcome> {
  if (!(await subjectExists(tx, input.subjectId))) return { kind: 'not_found' };
  const request = {
    collection: 'grants',
    tenantId: input.tenantId,
    filters: { subject: input.subjectId },
    limit: input.limit,
    cursor: input.cursor,
    cursorKey: input.cursorKey,
  };
  const resume = resumeAfter(request);
  if (resume.kind === 'invalid') return { kind: 'invalid_cursor' };

  const at = input.now.toISOString();
  const refreshExpiresAt = sql<Date | null>`(
    SELECT max(${refreshTokens.expiresAt}) FROM ${refreshTokens}
    WHERE ${refreshTokens.grantId} = ${tokenGrants.id}
      AND ${refreshTokens.usedAt} IS NULL
      AND ${refreshTokens.expiresAt} > ${at}::timestamptz)`.mapWith(refreshTokens.expiresAt);
  const rows = await tx
    .select({
      id: tokenGrants.id,
      clientDbId: tokenGrants.clientId,
      clientKey: clients.clientId,
      scope: tokenGrants.scope,
      createdAt: tokenGrants.createdAt,
      sessionId: tokenGrants.sessionId,
      refreshExpiresAt,
    })
    .from(tokenGrants)
    .innerJoin(clients, eq(clients.id, tokenGrants.clientId))
    .where(
      and(
        eq(tokenGrants.subjectId, input.subjectId),
        isNull(tokenGrants.revokedAt),
        ...(resume.after === undefined ? [] : [gt(tokenGrants.id, resume.after)]),
      ),
    )
    .orderBy(asc(tokenGrants.id))
    .limit(input.limit + 1);
  return idPage(request, rows);
}

async function subjectExists(tx: TenantScopedDatabase, subjectId: string): Promise<boolean> {
  return (await subjectRepository(tx).byId(subjectId)) !== null;
}

export interface GrantAuditEvent {
  readonly action: 'grant.revoke' | 'client.grants_revoke';
  readonly resourceType: 'subject' | 'client';
  readonly resourceId: string;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
  readonly outcome: 'allowed' | 'refused';
  readonly detail: Record<string, unknown>;
}

/** See `Audit` in `#/usecase/tenants.ts` — the same transactional write. */
export type Audit = (tx: TenantScopedDatabase, event: GrantAuditEvent) => Promise<void>;

export interface RevokeSubjectGrantsInput extends TargetCeilingInput {
  readonly clientDbId: string;
  readonly now: Date;
}

export type RevokeSubjectGrantsOutcome =
  { kind: 'not_found' } | TargetCeilingRefusal | { kind: 'revoked'; revoked: number };

// Every grant the subject holds through one client, session-bound and
// offline alike: `revokeForSubjectClient`, the write revoking a consent
// makes, without withdrawing the consent itself.
export async function revokeSubjectGrants(
  tx: TenantScopedDatabase,
  deps: { readonly audit: Audit },
  input: RevokeSubjectGrantsInput,
): Promise<RevokeSubjectGrantsOutcome> {
  if (!(await lockSubjectRow(tx, input.subjectId))) return { kind: 'not_found' };
  const refused = await refuseOverTargetCeiling(tx, deps.audit, 'grant.revoke', input);
  if (refused !== null) return refused;

  const revoked = await tokenGrantRepository(tx).revokeForSubjectClient(
    input.subjectId,
    input.clientDbId,
    input.now,
  );
  await deps.audit(tx, {
    action: 'grant.revoke',
    resourceType: 'subject',
    resourceId: input.subjectId,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
    detail: { client_id: input.clientDbId, revoked },
  });
  return { kind: 'revoked', revoked };
}

/** How many grants one revocation through a client takes; the rest wait for the next. */
export const CLIENT_GRANTS_REVOKE_LIMIT = BULK_WRITE_LIMIT;

export interface RevokeClientGrantsInput {
  readonly clientDbId: string;
  /** The most it revokes in this call: `CLIENT_GRANTS_REVOKE_LIMIT` unless a test says less. */
  readonly limit?: number;
  readonly now: Date;
  readonly callerCapabilities: ReadonlySet<string>;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export type RevokeClientGrantsOutcome =
  | { kind: 'not_found' }
  | TargetCeilingRefusal
  | { kind: 'revoked'; revoked: number; beyondCeiling: number; remaining: number };

// Every live grant issued through the client, whoever holds it, except
// those of a subject holding an admin capability the caller does not
// (ADR 0040), which are counted instead. A client mutation, so it is also
// held to the ceiling on the client's service account, as every other is.
// Revoking a grant ends no session: a session still signed in can be
// issued a fresh one.
export async function revokeClientGrants(
  tx: TenantScopedDatabase,
  deps: { readonly audit: Audit },
  input: RevokeClientGrantsInput,
): Promise<RevokeClientGrantsOutcome> {
  const known = await clientRepository(tx).byId(input.clientDbId);
  if (known === null) return { kind: 'not_found' };
  const refused = await refuseOverServiceAccountCeiling(
    tx,
    deps.audit,
    'client.grants_revoke',
    known.serviceSubjectId,
    input,
    { type: 'client', id: input.clientDbId },
  );
  if (refused !== null) return refused;
  await tx
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.id, input.clientDbId))
    .for('no key update');

  const live = and(eq(tokenGrants.clientId, input.clientDbId), isNull(tokenGrants.revokedAt));
  const beyond = subjectsBeyond(input.callerCapabilities);
  const reachable = beyond === null ? live : and(live, isNotBeyond(tokenGrants.subjectId, beyond));
  const batch = tx
    .select({ id: tokenGrants.id })
    .from(tokenGrants)
    .where(reachable)
    .orderBy(asc(tokenGrants.id))
    .limit(input.limit ?? CLIENT_GRANTS_REVOKE_LIMIT);
  const revoked = await tx
    .update(tokenGrants)
    .set({ revokedAt: input.now })
    .where(inArray(tokenGrants.id, batch))
    .returning({ id: tokenGrants.id });
  const remaining = await countAtMost(tx, {
    table: tokenGrants,
    where: reachable,
  });
  const beyondCeiling =
    beyond === null
      ? 0
      : await countAtMost(tx, {
          table: tokenGrants,
          where: and(live, isBeyond(tokenGrants.subjectId, beyond)),
        });

  await deps.audit(tx, {
    action: 'client.grants_revoke',
    resourceType: 'client',
    resourceId: input.clientDbId,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
    detail: { revoked: revoked.length, beyond_ceiling: beyondCeiling },
  });
  return { kind: 'revoked', revoked: revoked.length, beyondCeiling, remaining };
}
