import { type TenantScopedDatabase } from '@odudu/db';
import { auditRepository } from '@odudu/domain-audit';
import { clientRepository } from '@odudu/domain-tenant';

/**
 * Clears every secret a rotation kept whose window ended at or before
 * `now`, and records each expiry beside the rotation that set it. Nothing
 * here keeps a secret alive: verification refuses one from the instant its
 * window ends, so this pass only stops holding a hash nothing can use.
 */
export async function expireRotatedClientSecrets(
  tx: TenantScopedDatabase,
  now: Date,
): Promise<number> {
  const cleared = await clientRepository(tx).clearExpiredPreviousSecrets(now);
  for (const client of cleared) {
    await auditRepository(tx).record({
      eventType: 'admin_mutation',
      action: 'client.secret_expired',
      outcome: 'allowed',
      resourceType: 'client',
      resourceId: client.id,
    });
  }
  return cleared.length;
}
