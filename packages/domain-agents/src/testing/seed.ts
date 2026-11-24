import { tenants, type TenantScopedDatabase } from '@odudu/db';
import { subjectRepository } from '@odudu/domain-identity';
import { clients } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { sql } from 'drizzle-orm';

export interface Seeded {
  tenantId: string;
  ownerId: string;
  clientId: string;
  grantId: string;
}

// Relative to the run, so no fixture ages out; the repositories take their clock
// as an argument and never read the database's.
export const NOW = new Date(Math.floor(Date.now() / 1000) * 1000);
export const IN_AN_HOUR = new Date(NOW.getTime() + 3_600_000);

export async function seedOwner(tx: TenantScopedDatabase, tenantId: string): Promise<Seeded> {
  await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
  const clientId = newId();
  await tx.insert(clients).values({
    id: clientId,
    tenantId,
    clientId: `client-${clientId}`,
    name: 'An agent',
    type: 'confidential',
    secretHash: 'hashed:secret',
  });
  const owner = await subjectRepository(tx).create({ tenantId, type: 'user' });
  const grantId = newId();
  await tx.execute(
    sql`insert into token_grants (id, tenant_id, client_id, subject_id, scope)
        values (${grantId}, ${tenantId}, ${clientId}, ${owner.id}, 'openid')`,
  );
  return { tenantId, ownerId: owner.id, clientId, grantId };
}

// The database's own message behind a failed query, or null when it succeeded.
export async function refusalOf(attempt: Promise<unknown>): Promise<string | null> {
  try {
    await attempt;
    return null;
  } catch (error) {
    return String(error instanceof Error && error.cause !== undefined ? error.cause : error);
  }
}
