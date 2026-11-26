import { type TenantScopedDatabase } from '@odudu/db';
import { OduduError } from '@odudu/kernel';
import { clientRepository } from '#/repository/clients';
import { type ClientRecord } from '#/schema/clients';
import { ASSISTANT_CLIENT_ID, ASSISTANT_CLIENT_NAME } from '#/service/assistant-client';

/**
 * The built-in `odudu-assistant` client row: public, no secret, marked
 * `builtinAssistant`. Idempotent: a second pass finds the marked client and
 * writes nothing. A client that carries the id without the mark is refused,
 * never adopted. The OIDC configuration that makes it an agent type and
 * unusable at the protocol endpoints lives in protocol-oidc, whose
 * `provisionAssistantClient` calls this and adds it.
 */
export async function provisionAssistantClientRow(
  tx: TenantScopedDatabase,
  tenantId: string,
): Promise<ClientRecord> {
  const clients = clientRepository(tx);
  const existing = await clients.byClientId(ASSISTANT_CLIENT_ID);
  if (existing !== null) {
    if (!existing.builtinAssistant) {
      throw new OduduError(
        'assistant_client_not_builtin',
        `client ${ASSISTANT_CLIENT_ID} already exists in this tenant and is not the built-in assistant client`,
      );
    }
    return existing;
  }
  return clients.create({
    tenantId,
    clientId: ASSISTANT_CLIENT_ID,
    name: ASSISTANT_CLIENT_NAME,
    type: 'public',
    secretHash: null,
    builtinAssistant: true,
  });
}
