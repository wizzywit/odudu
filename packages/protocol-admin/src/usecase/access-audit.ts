import { type TenantScopedDatabase } from '@odudu/db';
import { auditRepository } from '@odudu/domain-audit';
import { type AdminCapability } from '#/service/capability';
import { type AdminPrincipal, type ForeignIssuer } from '#/usecase/authenticate-admin';

export async function recordCapabilityRefused(
  tx: TenantScopedDatabase,
  principal: AdminPrincipal,
  capability: AdminCapability,
): Promise<void> {
  await auditRepository(tx).record({
    eventType: 'admin_access',
    action: 'capability.refused',
    outcome: 'refused',
    actorTenantId: principal.issuerTenantId,
    actorSubjectId: principal.subjectId,
    actorClientId: principal.clientDbId,
    detail: { capability, reason: 'missing_capability' },
  });
}

export async function recordForeignIssuer(
  tx: TenantScopedDatabase,
  foreign: ForeignIssuer,
): Promise<void> {
  await auditRepository(tx).record({
    eventType: 'admin_access',
    action: 'token.foreign_issuer',
    outcome: 'refused',
    actorTenantId: foreign.issuerTenantId,
    actorSubjectId: foreign.subjectId,
    actorClientId: foreign.clientDbId,
    detail: { reason: 'foreign_issuer' },
  });
}
