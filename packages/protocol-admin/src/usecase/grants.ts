import { type TenantScopedDatabase } from '@odudu/db';
import { subjectRepository } from '@odudu/domain-identity';
import { clients } from '@odudu/domain-tenant';
import { refreshTokens, tokenGrantRepository, tokenGrants } from '@odudu/protocol-oidc';
import { and, asc, count, eq, gt, inArray, isNull, not, sql } from 'drizzle-orm';
import { subjectsBeyond } from '#/service/capability-ceiling';
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

export interface RevokeClientGrantsInput {
  readonly clientDbId: string;
  readonly now: Date;
  readonly callerCapabilities: ReadonlySet<string>;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export type RevokeClientGrantsOutcome =
  { kind: 'not_found' } | { kind: 'revoked'; revoked: number; beyondCeiling: number };

// Every live grant issued through the client, whoever holds it, except
// those of a subject holding an admin capability the caller does not
// (ADR 0040), which are counted instead. Revoking a grant ends no session:
// a session still signed in can be issued a fresh one.
export async function revokeClientGrants(
  tx: TenantScopedDatabase,
  deps: { readonly audit: Audit },
  input: RevokeClientGrantsInput,
): Promise<RevokeClientGrantsOutcome> {
  const client = await tx
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.id, input.clientDbId))
    .for('no key update');
  if (client.length === 0) return { kind: 'not_found' };

  const live = and(eq(tokenGrants.clientId, input.clientDbId), isNull(tokenGrants.revokedAt));
  const beyond = subjectsBeyond(input.callerCapabilities);
  const revoked = await tx
    .update(tokenGrants)
    .set({ revokedAt: input.now })
    .where(beyond === null ? live : and(live, not(inArray(tokenGrants.subjectId, beyond))))
    .returning({ id: tokenGrants.id });
  const beyondCeiling =
    beyond === null
      ? 0
      : ((
          await tx
            .select({ n: count() })
            .from(tokenGrants)
            .where(and(live, inArray(tokenGrants.subjectId, beyond)))
        )[0]?.n ?? 0);

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
  return { kind: 'revoked', revoked: revoked.length, beyondCeiling };
}
