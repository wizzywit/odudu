import { type TenantScopedDatabase } from '@odudu/db';
import { agentInstanceRepository, type AgentInstanceRecord } from '@odudu/domain-agents';
import { subjectRepository } from '@odudu/domain-identity';
import { clientRepository } from '@odudu/domain-tenant';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function isLive(instance: AgentInstanceRecord, now: Date): boolean {
  return (
    instance.revokedAt === null &&
    instance.expiresAt.getTime() > now.getTime() &&
    (instance.idleExpiresAt === null || instance.idleExpiresAt.getTime() > now.getTime())
  );
}

// Whether `head`, the outermost actor of a token's or grant's `act` chain, is an
// agent instance that has been revoked, has lapsed or has been deleted. An id
// that names a client or a subject other than an instance is an ordinary actor.
export async function actingInstanceEnded(
  tx: TenantScopedDatabase,
  head: string | undefined,
  now: Date,
): Promise<boolean> {
  if (head === undefined || !UUID.test(head)) return false;
  const instance = await agentInstanceRepository(tx).byId(head);
  if (instance !== null) return !isLive(instance, now);
  if ((await subjectRepository(tx).byId(head)) !== null) return false;
  return (await clientRepository(tx).byClientId(head)) === null;
}
