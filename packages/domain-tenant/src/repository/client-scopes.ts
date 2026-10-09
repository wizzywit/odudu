import {
  CLIENT_SCOPE_LIMIT,
  clientScopeLimitMessage,
  defaultScopeLimitMessage,
} from '@odudu/contracts/admin';
import { tenants, type TenantScopedDatabase } from '@odudu/db';
import { newId, OduduError } from '@odudu/kernel';
import { and, count, eq, inArray, isNotNull, sql } from 'drizzle-orm';
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
    defaultClientAssignment: row.defaultClientAssignment,
    consentText: row.consentText,
    displayOrder: row.displayOrder,
    createdAt: row.createdAt,
  };
}

export interface NewClientScope {
  tenantId: string;
  name: string;
  description?: string | null;
  includeInIdToken?: boolean;
  includeInAccessToken?: boolean;
  defaultClientAssignment?: ClientScopeAssignment | null;
  consentText?: string | null;
  displayOrder?: number;
}

export interface ClientScopePatch {
  description?: string | null;
  includeInIdToken?: boolean;
  includeInAccessToken?: boolean;
  defaultClientAssignment?: ClientScopeAssignment | null;
  consentText?: string | null;
  displayOrder?: number;
}

/** Thrown when a client already carries `CLIENT_SCOPE_LIMIT` scopes and would take another. */
export class ClientScopeLimitError extends Error {
  constructor() {
    super(clientScopeLimitMessage());
    this.name = 'ClientScopeLimitError';
  }
}

/** Thrown when `CLIENT_SCOPE_LIMIT` scopes are already marked for every new client. */
export class DefaultScopeLimitError extends Error {
  constructor() {
    super(defaultScopeLimitMessage());
    this.name = 'DefaultScopeLimitError';
  }
}

export function clientScopeRepository(tx: TenantScopedDatabase) {
  const refuseWhenClientIsFull = async (clientId: string): Promise<void> => {
    if ((await repository.countAssignedUpTo(clientId, CLIENT_SCOPE_LIMIT)) >= CLIENT_SCOPE_LIMIT) {
      throw new ClientScopeLimitError();
    }
  };
  const refuseWhenDefaultsAreFull = async (tenantId: string): Promise<void> => {
    // The tenant's lock, as `SCOPE_LIMIT`'s count takes it, so two marks cannot both count room.
    await repository.lockCreation(tenantId);
    if ((await repository.countDefaultsUpTo(tenantId, CLIENT_SCOPE_LIMIT)) >= CLIENT_SCOPE_LIMIT) {
      throw new DefaultScopeLimitError();
    }
  };
  const repository = {
    async allForTenant(): Promise<ClientScopeRecord[]> {
      const rows = await tx.select().from(clientScopes);
      return rows.map(toRecord);
    },

    // The scopes a client carries, counted no further than `limit`: its key
    // leads with the client, so this reads that client's rows alone.
    async countAssignedUpTo(clientId: string, limit: number): Promise<number> {
      const held = tx
        .select({ one: sql<number>`1`.as('one') })
        .from(clientScopeAssignments)
        .where(eq(clientScopeAssignments.clientId, clientId))
        .limit(limit)
        .as('held');
      const rows = await tx.select({ count: count() }).from(held);
      return rows[0]?.count ?? 0;
    },

    // The scopes of one tenant marked for every new client, counted no further
    // than `limit`: named rather than left to the row policy, so a connection
    // that sees every tenant counts the same.
    async countDefaultsUpTo(tenantId: string, limit: number): Promise<number> {
      const held = tx
        .select({ one: sql<number>`1`.as('one') })
        .from(clientScopes)
        .where(
          and(eq(clientScopes.tenantId, tenantId), isNotNull(clientScopes.defaultClientAssignment)),
        )
        .limit(limit)
        .as('held');
      const rows = await tx.select({ count: count() }).from(held);
      return rows[0]?.count ?? 0;
    },

    // Whether the client already carries the scope, so a change to it is not a new one.
    async assigned(clientId: string, clientScopeId: string): Promise<boolean> {
      const rows = await tx
        .select({ one: sql<number>`1` })
        .from(clientScopeAssignments)
        .where(
          and(
            eq(clientScopeAssignments.clientId, clientId),
            eq(clientScopeAssignments.clientScopeId, clientScopeId),
          ),
        );
      return rows.length > 0;
    },

    async byId(id: string): Promise<ClientScopeRecord | null> {
      const rows = await tx.select().from(clientScopes).where(eq(clientScopes.id, id));
      const row = rows[0];
      return row === undefined ? null : toRecord(row);
    },

    // Takes the tenant row's lock for the rest of the transaction, so a count
    // against a ceiling and the insert after it are one decision: two creates
    // cannot both see room. The same lock `clientRepository.lockCapacity` takes,
    // and it waits for no other tenant. True when the tenant row was there to lock.
    async lockCreation(tenantId: string): Promise<boolean> {
      const rows = await tx
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .for('no key update');
      return rows.length > 0;
    },

    // How many scopes the tenant defines, counted no further than `limit`.
    async countUpTo(limit: number): Promise<number> {
      const held = tx
        .select({ one: sql<number>`1`.as('one') })
        .from(clientScopes)
        .limit(limit)
        .as('held');
      const rows = await tx.select({ count: count() }).from(held);
      return rows[0]?.count ?? 0;
    },

    async byNames(names: readonly string[]): Promise<ClientScopeRecord[]> {
      if (names.length === 0) return [];
      const rows = await tx
        .select()
        .from(clientScopes)
        .where(inArray(clientScopes.name, [...names]));
      const byName = new Map(rows.map((row) => [row.name, toRecord(row)]));
      return [...new Set(names)].flatMap((name) => byName.get(name) ?? []);
    },

    async byName(name: string): Promise<ClientScopeRecord | null> {
      const rows = await tx.select().from(clientScopes).where(eq(clientScopes.name, name));
      const row = rows[0];
      return row === undefined ? null : toRecord(row);
    },

    async amend(id: string, patch: ClientScopePatch): Promise<ClientScopeRecord> {
      if (patch.defaultClientAssignment !== undefined && patch.defaultClientAssignment !== null) {
        const current = await tx
          .select({ marked: clientScopes.defaultClientAssignment, tenantId: clientScopes.tenantId })
          .from(clientScopes)
          .where(eq(clientScopes.id, id));
        const row = current[0];
        if (row?.marked === null) await refuseWhenDefaultsAreFull(row.tenantId);
      }
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
      if (input.defaultClientAssignment !== undefined && input.defaultClientAssignment !== null) {
        await refuseWhenDefaultsAreFull(input.tenantId);
      }
      const rows = await tx
        .insert(clientScopes)
        .values({
          id: newId(),
          tenantId: input.tenantId,
          name: input.name,
          description: input.description ?? null,
          includeInIdToken: input.includeInIdToken ?? true,
          includeInAccessToken: input.includeInAccessToken ?? true,
          defaultClientAssignment: input.defaultClientAssignment ?? null,
          consentText: input.consentText ?? null,
          displayOrder: input.displayOrder ?? 0,
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
        .where(eq(clients.id, clientId))
        // Held to the end of the transaction, so two assignments cannot both count room.
        .for('no key update');
      const client = clientRows[0];
      if (client === undefined) {
        throw new Error(`cannot assign a scope to unknown client ${clientId}`);
      }
      await refuseWhenClientIsFull(clientId);

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
        .where(eq(clients.id, clientId))
        // Held to the end of the transaction, so two assignments cannot both count room.
        .for('no key update');
      const client = clientRows[0];
      if (client === undefined) {
        throw new Error(`cannot assign a scope to unknown client ${clientId}`);
      }
      if (!(await repository.assigned(clientId, clientScopeId))) {
        await refuseWhenClientIsFull(clientId);
      }

      await tx
        .insert(clientScopeAssignments)
        .values({ tenantId: client.tenantId, clientId, clientScopeId, assignment })
        .onConflictDoUpdate({
          target: [clientScopeAssignments.clientId, clientScopeAssignments.clientScopeId],
          set: { assignment },
        });
    },

    // RLS filters both keys to this tenant, so a foreign clientId or
    // clientScopeId simply matches no row rather than needing its own check
    // — the same reasoning `delete` above rests on.
    async unassign(clientId: string, clientScopeId: string): Promise<boolean> {
      const rows = await tx
        .delete(clientScopeAssignments)
        .where(
          and(
            eq(clientScopeAssignments.clientId, clientId),
            eq(clientScopeAssignments.clientScopeId, clientScopeId),
          ),
        )
        .returning({ clientId: clientScopeAssignments.clientId });
      return rows.length > 0;
    },
  };
  return repository;
}
