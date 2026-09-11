import { type RealmScopedDatabase } from '@odudu/db';
import { newId } from '@odudu/kernel';
import { eq } from 'drizzle-orm';
import { clients, type ClientRecord } from '#/schema/clients';

export type { ClientRecord } from '#/schema/clients';

function toRecord(row: typeof clients.$inferSelect): ClientRecord {
  return {
    id: row.id,
    realmId: row.realmId,
    clientId: row.clientId,
    name: row.name,
    enabled: row.enabled,
    type: row.type as ClientRecord['type'],
    secretHash: row.secretHash,
    createdAt: row.createdAt,
    serviceSubjectId: row.serviceSubjectId,
  };
}

export interface NewClient {
  realmId: string;
  clientId: string;
  name: string;
  type: 'public' | 'confidential';
  secretHash: string | null;
  enabled?: boolean;
  serviceSubjectId?: string | null;
}

export function clientRepository(tx: RealmScopedDatabase) {
  return {
    async byClientId(clientId: string): Promise<ClientRecord | null> {
      const rows = await tx.select().from(clients).where(eq(clients.clientId, clientId));
      const row = rows[0];
      return row === undefined ? null : toRecord(row);
    },

    // The bootstrap seed command creates clients through this repository, and
    // client resolution reads them back alongside their OIDC config, so an
    // insert path belongs here rather than only in a migration.
    async create(input: NewClient): Promise<ClientRecord> {
      const rows = await tx
        .insert(clients)
        .values({
          id: newId(),
          realmId: input.realmId,
          clientId: input.clientId,
          name: input.name,
          type: input.type,
          secretHash: input.secretHash,
          enabled: input.enabled ?? true,
          serviceSubjectId: input.serviceSubjectId ?? null,
        })
        .returning();
      const row = rows[0];
      if (row === undefined) {
        throw new Error('insert into clients returned no row');
      }
      return toRecord(row);
    },
  };
}
