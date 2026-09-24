import { isUniqueViolation, tenants, type TenantScopedDatabase } from '@odudu/db';
import { newId } from '@odudu/kernel';
import { count, eq } from 'drizzle-orm';
import { clients, type ClientRecord } from '#/schema/clients';

export type { ClientRecord } from '#/schema/clients';

/** Thrown by `create` when `client_id` collides with an existing client in the tenant. */
export class ClientIdConflictError extends Error {
  constructor(clientId: string) {
    super(`client_id ${JSON.stringify(clientId)} is already in use`);
    this.name = 'ClientIdConflictError';
  }
}

function toRecord(row: typeof clients.$inferSelect): ClientRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    clientId: row.clientId,
    name: row.name,
    enabled: row.enabled,
    type: row.type as ClientRecord['type'],
    secretHash: row.secretHash,
    createdAt: row.createdAt,
    serviceSubjectId: row.serviceSubjectId,
    fullScopeAllowed: row.fullScopeAllowed,
    registrationOrigin: row.registrationOrigin as ClientRecord['registrationOrigin'],
    builtinAdmin: row.builtinAdmin,
  };
}

export interface NewClient {
  tenantId: string;
  clientId: string;
  name: string;
  type: 'public' | 'confidential';
  secretHash: string | null;
  enabled?: boolean;
  serviceSubjectId?: string | null;
  fullScopeAllowed?: boolean;
  builtinAdmin?: boolean;
  // Defaults to the column's own default ('seeded'): every caller that
  // predates dynamic registration creates a client that way, and only
  // the registration endpoint has reason to name 'anonymous' or 'token'.
  registrationOrigin?: ClientRecord['registrationOrigin'];
}

// What the registration endpoint's cap check locks and counts, returned
// together so a caller cannot read the count without having taken the lock
// the comparison depends on.
export interface ClientCapacity {
  maxClients: number;
  count: number;
}

export function clientRepository(tx: TenantScopedDatabase) {
  return {
    async byClientId(clientId: string): Promise<ClientRecord | null> {
      const rows = await tx.select().from(clients).where(eq(clients.clientId, clientId));
      const row = rows[0];
      return row === undefined ? null : toRecord(row);
    },

    // By the internal uuid (clients.id), not the OAuth client_id string —
    // what a caller holding a resolved client id (a consent lookup, a
    // token grant) uses to read the client back, rather than round-tripping
    // through byClientId with the string it already left behind.
    async byId(id: string): Promise<ClientRecord | null> {
      const rows = await tx.select().from(clients).where(eq(clients.id, id));
      const row = rows[0];
      return row === undefined ? null : toRecord(row);
    },

    // `byId` with the row locked for the rest of the transaction, so a
    // read-compare-write amendment cannot interleave with another: two
    // callers holding the same `ETag` would otherwise both match and the
    // second write would silently replace the first.
    async byIdForUpdate(id: string): Promise<ClientRecord | null> {
      const rows = await tx.select().from(clients).where(eq(clients.id, id)).for('update');
      const row = rows[0];
      return row === undefined ? null : toRecord(row);
    },

    // The bootstrap seed command creates clients through this repository, and
    // client resolution reads them back alongside their OIDC config, so an
    // insert path belongs here rather than only in a migration.
    async create(input: NewClient): Promise<ClientRecord> {
      let rows: (typeof clients.$inferSelect)[];
      try {
        rows = await tx
          .insert(clients)
          .values({
            id: newId(),
            tenantId: input.tenantId,
            clientId: input.clientId,
            name: input.name,
            type: input.type,
            secretHash: input.secretHash,
            enabled: input.enabled ?? true,
            serviceSubjectId: input.serviceSubjectId ?? null,
            fullScopeAllowed: input.fullScopeAllowed ?? false,
            builtinAdmin: input.builtinAdmin ?? false,
            ...(input.registrationOrigin === undefined
              ? {}
              : { registrationOrigin: input.registrationOrigin }),
          })
          .returning();
      } catch (error) {
        if (isUniqueViolation(error)) throw new ClientIdConflictError(input.clientId);
        throw error;
      }
      const row = rows[0];
      if (row === undefined) {
        throw new Error('insert into clients returned no row');
      }
      return toRecord(row);
    },

    // Every amendable `clients` column (client-patch.ts's
    // `AMENDABLE_CLIENT_FIELDS`) in one statement — the caller has already
    // refused anything else by name.
    async update(
      id: string,
      patch: Partial<Pick<typeof clients.$inferInsert, 'name' | 'enabled' | 'fullScopeAllowed'>>,
    ): Promise<ClientRecord> {
      const rows = await tx.update(clients).set(patch).where(eq(clients.id, id)).returning();
      const row = rows[0];
      if (row === undefined) {
        throw new Error(`client ${id} not found while amending it`);
      }
      return toRecord(row);
    },

    // Cascades to `client_oidc_config` (client_oidc_config.clientId
    // references clients.id ON DELETE CASCADE) — nothing here deletes the
    // config row a second time.
    async delete(id: string): Promise<void> {
      await tx.delete(clients).where(eq(clients.id, id));
    },

    // `secret_hash` is refused by the general amendment (client-patch.ts's
    // `refusalFor`) and rotated only through here.
    async rotateSecret(id: string, secretHash: string): Promise<ClientRecord> {
      const rows = await tx
        .update(clients)
        .set({ secretHash })
        .where(eq(clients.id, id))
        .returning();
      const row = rows[0];
      if (row === undefined) {
        throw new Error(`client ${id} not found while rotating its secret`);
      }
      return toRecord(row);
    },

    // `SELECT ... FOR UPDATE` on the tenant row before the `COUNT`, in the
    // same transaction the caller inserts the new client in — a bare COUNT
    // then INSERT lets two concurrent registrations both see room under the
    // cap. Serialises registrations within one tenant; a different tenant's
    // registration takes a different row and is not blocked by this one.
    async lockCapacity(tenantId: string): Promise<ClientCapacity> {
      const lockRows = await tx
        .select({ maxClients: tenants.maxClients })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .for('update');
      const maxClients = lockRows[0]?.maxClients;
      if (maxClients === undefined) {
        throw new Error(`tenant ${tenantId} not found while locking its client capacity`);
      }
      const countRows = await tx
        .select({ count: count() })
        .from(clients)
        .where(eq(clients.tenantId, tenantId));
      return { maxClients, count: countRows[0]?.count ?? 0 };
    },
  };
}
