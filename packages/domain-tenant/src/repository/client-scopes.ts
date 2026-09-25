import { type TenantScopedDatabase } from '@odudu/db';
import { newId, OduduError } from '@odudu/kernel';
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
    tenantId: row.tenantId,
    name: row.name,
    description: row.description,
    includeInIdToken: row.includeInIdToken,
    includeInAccessToken: row.includeInAccessToken,
    createdAt: row.createdAt,
  };
}

export interface NewClientScope {
  tenantId: string;
  name: string;
  description?: string | null;
  includeInIdToken?: boolean;
  includeInAccessToken?: boolean;
}

export interface ClientScopePatch {
  description?: string | null;
  includeInIdToken?: boolean;
  includeInAccessToken?: boolean;
}

export function clientScopeRepository(tx: TenantScopedDatabase) {
  return {
    async allForTenant(): Promise<ClientScopeRecord[]> {
      const rows = await tx.select().from(clientScopes);
      return rows.map(toRecord);
    },

    async byId(id: string): Promise<ClientScopeRecord | null> {
      const rows = await tx.select().from(clientScopes).where(eq(clientScopes.id, id));
      const row = rows[0];
      return row === undefined ? null : toRecord(row);
    },

    async byName(name: string): Promise<ClientScopeRecord | null> {
      const rows = await tx.select().from(clientScopes).where(eq(clientScopes.name, name));
      const row = rows[0];
      return row === undefined ? null : toRecord(row);
    },

    async amend(id: string, patch: ClientScopePatch): Promise<ClientScopeRecord> {
      const rows = await tx
        .update(clientScopes)
        .set(patch)
        .where(eq(clientScopes.id, id))
        .returning();
      const row = rows[0];
      if (row === undefined) {
        throw new OduduError('client_scope_not_found', `no client scope with id ${id}`);
      }
      return toRecord(row);
    },

    // `client_scope_assignments_scope_fk` and `client_scope_roles_scope_fk`
    // (0016_client_scopes.sql, 0017_roles.sql) both cascade: deleting a
    // scope removes every client assignment and role mapping naming it.
    async delete(id: string): Promise<boolean> {
      const rows = await tx
        .delete(clientScopes)
        .where(eq(clientScopes.id, id))
        .returning({ id: clientScopes.id });
      return rows.length > 0;
    },

    async forClient(clientId: string): Promise<ClientScopeRecord[]> {
      const rows = await tx
        .select({ scope: clientScopes })
        .from(clientScopeAssignments)
        .innerJoin(clientScopes, eq(clientScopeAssignments.clientScopeId, clientScopes.id))
        .where(eq(clientScopeAssignments.clientId, clientId));
      return rows.map((row) => toRecord(row.scope));
    },

    // Same join as forClient, with the one extra column a consent screen
    // needs: which side of default/optional each assignment landed on
    // (§2's ClientScopeAssignment). forClient stays as it is for every
    // caller that only needs the vocabulary, not the split.
    async forClientByAssignment(
      clientId: string,
    ): Promise<{ scope: ClientScopeRecord; assignment: ClientScopeAssignment }[]> {
      const rows = await tx
        .select({ scope: clientScopes, assignment: clientScopeAssignments.assignment })
        .from(clientScopeAssignments)
        .innerJoin(clientScopes, eq(clientScopeAssignments.clientScopeId, clientScopes.id))
        .where(eq(clientScopeAssignments.clientId, clientId));
      return rows.map((row) => ({ scope: toRecord(row.scope), assignment: row.assignment }));
    },

    async create(input: NewClientScope): Promise<ClientScopeRecord> {
      const rows = await tx
        .insert(clientScopes)
        .values({
          id: newId(),
          tenantId: input.tenantId,
          name: input.name,
          description: input.description ?? null,
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

    // tenant_id is not a caller-supplied argument: it is read back from the
    // client being assigned to, the same tenant RLS already scopes both
    // client and scope to.
    async assign(
      clientId: string,
      clientScopeId: string,
      assignment: ClientScopeAssignment,
    ): Promise<void> {
      const clientRows = await tx
        .select({ tenantId: clients.tenantId })
        .from(clients)
        .where(eq(clients.id, clientId));
      const client = clientRows[0];
      if (client === undefined) {
        throw new Error(`cannot assign a scope to unknown client ${clientId}`);
      }

      await tx.insert(clientScopeAssignments).values({
        tenantId: client.tenantId,
        clientId,
        clientScopeId,
        assignment,
      });
    },

    // Provisioning a client's default scopes and an operator naming one
    // explicitly both reach for the same pair, so the second call narrows
    // or widens an existing assignment rather than colliding with it — the
    // seed CLI's assign-scope depends on this to run after client creation
    // has already assigned the tenant's default vocabulary.
    async assignOrUpdate(
      clientId: string,
      clientScopeId: string,
      assignment: ClientScopeAssignment,
    ): Promise<void> {
      const clientRows = await tx
        .select({ tenantId: clients.tenantId })
        .from(clients)
        .where(eq(clients.id, clientId));
      const client = clientRows[0];
      if (client === undefined) {
        throw new Error(`cannot assign a scope to unknown client ${clientId}`);
      }

      await tx
        .insert(clientScopeAssignments)
        .values({ tenantId: client.tenantId, clientId, clientScopeId, assignment })
        .onConflictDoUpdate({
          target: [clientScopeAssignments.clientId, clientScopeAssignments.clientScopeId],
          set: { assignment },
        });
    },
  };
}
