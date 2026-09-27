import { type TenantScopedDatabase } from '@odudu/db';
import { subjects } from '@odudu/domain-identity';
import { consentRepository, type SubjectConsent } from '@odudu/domain-tenant';
import { eq } from 'drizzle-orm';
import { redactedDiff } from '#/service/audit-detail';

export interface ConsentAuditEvent {
  readonly action: 'consent.revoke';
  readonly resourceType: 'consent';
  readonly resourceId: string;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
  readonly outcome: 'allowed' | 'refused' | 'failed';
  readonly detail?: Record<string, unknown>;
}

/** See `Audit` in `#/usecase/tenants.ts` — the same transactional write. */
export type Audit = (tx: TenantScopedDatabase, event: ConsentAuditEvent) => Promise<void>;

export interface ListConsentsInput {
  readonly subjectId: string;
}

export type ListConsentsOutcome =
  { kind: 'not_found' } | { kind: 'ok'; items: readonly SubjectConsent[] };

export async function listConsents(
  tx: TenantScopedDatabase,
  input: ListConsentsInput,
): Promise<ListConsentsOutcome> {
  const subjectRows = await tx
    .select({ id: subjects.id })
    .from(subjects)
    .where(eq(subjects.id, input.subjectId));
  if (subjectRows.length === 0) return { kind: 'not_found' };

  const items = await consentRepository(tx).forSubject(input.subjectId);
  return { kind: 'ok', items };
}

export interface RevokeConsentInput {
  readonly subjectId: string;
  readonly clientId: string;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export interface RevokeConsentDeps {
  readonly audit: Audit;
}

export type RevokeConsentOutcome = { kind: 'not_found' } | { kind: 'revoked' };

// Never revokes an already-issued token: a grant already redeemed for an
// access or refresh token is untouched, the same way ending a session
// leaves grants alone until the reaper or an explicit revoke reaches them.
// The next `/authorize` simply finds nothing recorded and asks again.
export async function revokeConsent(
  tx: TenantScopedDatabase,
  deps: RevokeConsentDeps,
  input: RevokeConsentInput,
): Promise<RevokeConsentOutcome> {
  const items = await consentRepository(tx).forSubject(input.subjectId);
  const consent = items.find((item) => item.clientId === input.clientId);
  if (consent === undefined) return { kind: 'not_found' };

  const removed = await consentRepository(tx).revoke(input.subjectId, input.clientId);
  if (!removed) return { kind: 'not_found' };

  await deps.audit(tx, {
    action: 'consent.revoke',
    resourceType: 'consent',
    resourceId: input.clientId,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
    detail: redactedDiff(
      'consent',
      { client_key: consent.clientKey, scope_names: [...consent.scopeNames] },
      null,
    ),
  });

  return { kind: 'revoked' };
}
