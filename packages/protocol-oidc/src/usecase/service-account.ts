import { type TenantScopedDatabase } from '@odudu/db';
import { subjectRepository } from '@odudu/domain-identity';
import { clientRepository, type ClientRecord } from '@odudu/domain-tenant';

async function lockedClient(tx: TenantScopedDatabase, client: ClientRecord): Promise<ClientRecord> {
  const row = await clientRepository(tx).byIdForUpdate(client.id);
  if (row === null)
    throw new Error(`client ${client.id} not found while changing its service account`);
  return row;
}

/**
 * Gives a confidential client its service account unless it has one, and
 * answers the client as it now stands. The client row is locked first, so
 * two transactions switching the grant on together queue and the second
 * finds the account the first made: one client, one account, with no
 * constraint needed beyond the pointer being a single column.
 */
export async function ensureServiceAccount(
  tx: TenantScopedDatabase,
  client: ClientRecord,
): Promise<ClientRecord> {
  const row = await lockedClient(tx, client);
  if (row.type !== 'confidential') {
    throw new Error(`${row.clientId} is a public client and has no service account`);
  }
  // An account the upgrade kept idle is in use again: it keeps the roles
  // an operator gave it, and stops being listed as unused.
  if (row.serviceSubjectId !== null) {
    await clientRepository(tx).clearServiceAccountIdle(row.id);
    return row;
  }
  const subject = await subjectRepository(tx).create({ tenantId: row.tenantId, type: 'service' });
  return clientRepository(tx).setServiceSubject(row.id, subject.id);
}

/**
 * Takes a client's service account away, and with it every token grant,
 * role assignment, session and consent the account held: the subject is
 * deleted, and what names it cascades. A later account for the same client
 * starts with nothing, so switching the grant back on never restores what
 * the earlier one was allowed. A client with no account is left alone.
 */
export async function retireServiceAccount(
  tx: TenantScopedDatabase,
  client: ClientRecord,
): Promise<ClientRecord> {
  const row = await lockedClient(tx, client);
  const subjectId = row.serviceSubjectId;
  if (subjectId === null) return row;
  const updated = await clientRepository(tx).setServiceSubject(row.id, null);
  await subjectRepository(tx).delete(subjectId);
  return updated;
}
