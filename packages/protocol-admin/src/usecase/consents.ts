import { type TenantScopedDatabase } from '@odudu/db';
import { subjects } from '@odudu/domain-identity';
import { consentRepository, type SubjectConsent } from '@odudu/domain-tenant';
import { tokenGrantRepository } from '@odudu/protocol-oidc';
import { eq } from 'drizzle-orm';
import { redactedDiff } from '#/service/audit-detail';

// `resourceType: 'subject'` and not `'consent'`: a consent names no row of
// its own a caller could look up afterward — `consents` carries no wire
// id — so this event is filed the same way `subject.credential_delete` is,
// on the subject the consent belonged to, with which client in `detail`.
export interface ConsentAuditEvent {
  readonly action: 'consent.revoke';
  readonly resourceType: 'subject';
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
  readonly now: Date;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export interface RevokeConsentDeps {
  readonly audit: Audit;
}

export type RevokeConsentOutcome = { kind: 'not_found' } | { kind: 'revoked' };

// Withdraws the grant and every token issued under it in the same
// transaction — an offline_access family rotates indefinitely
// (`refresh-rotation.ts`'s own comment: bounded only by its own TTL per
// rotation, never by the consent that first authorized it), so leaving
// its grants alone would mean a subject who revoked access keeps being
// impersonated by whatever token that client already held. The same
// reasoning `endSession` already applies to a session's own grants
// (`tokenGrantRepository.revokeForSession`) — this is that pattern's
// consent-scoped sibling.
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

  const grantsRevoked = await tokenGrantRepository(tx).revokeForSubjectClient(
    input.subjectId,
    input.clientId,
    input.now,
  );

  await deps.audit(tx, {
    action: 'consent.revoke',
    resourceType: 'subject',
    resourceId: input.subjectId,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
    detail: {
      ...redactedDiff(
        'subject',
        { client_id: input.clientId, scope_names: [...consent.scopeNames] },
        null,
      ),
      grants_revoked: grantsRevoked,
    },
  });

  return { kind: 'revoked' };
}
