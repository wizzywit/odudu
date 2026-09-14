import { type RealmScopedDatabase } from '@odudu/db';
import { newId } from '@odudu/kernel';
import { eq } from 'drizzle-orm';
import {
  clientScopeAssignments,
  clientScopes,
  type ClientScopeAssignment,
  type ClientScopeRecord,
} from '#/schema/client-scopes';
import { clients } from '#/schema/clients';

export type { ClientScopeAssignment, ClientScopeRecord } from '#/schema/client-scopes';

function toRecord(row: typeof clientScopes.$inferSelect): ClientScopeRecord {
  return {
    id: row.id,
    realmId: row.realmId,
    name: row.name,
    description: row.description,
    includeInTokenScope: row.includeInTokenScope,
    includeInIdToken: row.includeInIdToken,
    includeInAccessToken: row.includeInAccessToken,
    createdAt: row.createdAt,
  };
}

export interface NewClientScope {
  realmId: string;
  name: string;
  description?: string | null;
  includeInTokenScope?: boolean;
  includeInIdToken?: boolean;
  includeInAccessToken?: boolean;
}

export function clientScopeRepository(tx: RealmScopedDatabase) {
  return {
    async allForRealm(): Promise<ClientScopeRecord[]> {
      const rows = await tx.select().from(clientScopes);
      return rows.map(toRecord);
    },

    async byName(name: string): Promise<ClientScopeRecord | null> {
      const rows = await tx.select().from(clientScopes).where(eq(clientScopes.name, name));
      const row = rows[0];
      return row === undefined ? null : toRecord(row);
    },

    async forClient(clientId: string): Promise<ClientScopeRecord[]> {
      const rows = await tx
        .select({ scope: clientScopes })
        .from(clientScopeAssignments)
        .innerJoin(clientScopes, eq(clientScopeAssignments.clientScopeId, clientScopes.id))
        .where(eq(clientScopeAssignments.clientId, clientId));
      return rows.map((row) => toRecord(row.scope));
    },

    async create(input: NewClientScope): Promise<ClientScopeRecord> {
      const rows = await tx
        .insert(clientScopes)
        .values({
          id: newId(),
          realmId: input.realmId,
          name: input.name,
          description: input.description ?? null,
          includeInTokenScope: input.includeInTokenScope ?? true,
          includeInIdToken: input.includeInIdToken ?? true,
          includeInAccessToken: input.includeInAccessToken ?? true,
        })
        .returning();
      const row = rows[0];
      if (row === undefined) {
        throw new Error('insert into client_scopes returned no row');
      }
      return toRecord(row);
    },

    // realm_id is not a caller-supplied argument: it is read back from the
    // client being assigned to, the same realm RLS already scopes both
    // client and scope to.
    async assign(
      clientId: string,
      clientScopeId: string,
      assignment: ClientScopeAssignment,
    ): Promise<void> {
      const clientRows = await tx
        .select({ realmId: clients.realmId })
        .from(clients)
        .where(eq(clients.id, clientId));
      const client = clientRows[0];
      if (client === undefined) {
        throw new Error(`cannot assign a scope to unknown client ${clientId}`);
      }

      await tx.insert(clientScopeAssignments).values({
        realmId: client.realmId,
        clientId,
        clientScopeId,
        assignment,
      });
    },

    // Provisioning a client's default scopes and an operator naming one
    // explicitly both reach for the same pair, so the second call narrows
    // or widens an existing assignment rather than colliding with it — the
    // seed CLI's assign-scope depends on this to run after client creation
    // has already assigned the realm's default vocabulary.
    async assignOrUpdate(
      clientId: string,
      clientScopeId: string,
      assignment: ClientScopeAssignment,
    ): Promise<void> {
      const clientRows = await tx
        .select({ realmId: clients.realmId })
        .from(clients)
        .where(eq(clients.id, clientId));
      const client = clientRows[0];
      if (client === undefined) {
        throw new Error(`cannot assign a scope to unknown client ${clientId}`);
      }

      await tx
        .insert(clientScopeAssignments)
        .values({ realmId: client.realmId, clientId, clientScopeId, assignment })
        .onConflictDoUpdate({
          target: [clientScopeAssignments.clientId, clientScopeAssignments.clientScopeId],
          set: { assignment },
        });
    },
  };
}
