import { type TenantScopedDatabase } from '@odudu/db';
import { newId } from '@odudu/kernel';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { clientScopes } from '#/schema/client-scopes';
import { clients } from '#/schema/clients';
import { consentScopes, consents } from '#/schema/consents';

export interface SubjectConsent {
  readonly clientId: string;
  readonly clientKey: string;
  readonly scopeNames: readonly string[];
  readonly grantedAt: Date;
}

export function consentRepository(tx: TenantScopedDatabase) {
  return {
    async grantedScopeIds(
      tenantId: string,
      subjectId: string,
      clientId: string,
    ): Promise<ReadonlySet<string>> {
      const rows = await tx
        .select({ clientScopeId: consentScopes.clientScopeId })
        .from(consentScopes)
        .innerJoin(consents, eq(consentScopes.consentId, consents.id))
        .where(
          and(
            eq(consents.tenantId, tenantId),
            eq(consents.subjectId, subjectId),
            eq(consents.clientId, clientId),
          ),
        );
      return new Set(rows.map((row) => row.clientScopeId));
    },

    // Replaces the granted set; it does not merge. A consent screen shows
    // the whole set and the user's answer is the whole answer, so an
    // unticked box has to mean "revoked", not "unmentioned". The upsert, the
    // delete of what fell out of the new set, and the insert of what is new
    // to it all run against the one transaction `tx` already is.
    async record(
      tenantId: string,
      subjectId: string,
      clientId: string,
      scopeIds: readonly string[],
    ): Promise<void> {
      const rows = await tx
        .insert(consents)
        .values({ id: newId(), tenantId, subjectId, clientId })
        .onConflictDoUpdate({
          target: [consents.tenantId, consents.subjectId, consents.clientId],
          set: { updatedAt: sql`now()` },
        })
        .returning({ id: consents.id });
      const row = rows[0];
      if (row === undefined) {
        throw new Error('upsert into consents returned no row');
      }
      const consentId = row.id;

      await tx
        .delete(consentScopes)
        .where(
          and(
            eq(consentScopes.consentId, consentId),
            scopeIds.length > 0
              ? notInArray(consentScopes.clientScopeId, [...scopeIds])
              : undefined,
          ),
        );

      if (scopeIds.length > 0) {
        await tx
          .insert(consentScopes)
          .values(scopeIds.map((clientScopeId) => ({ tenantId, consentId, clientScopeId })))
          .onConflictDoNothing();
      }
    },

    // Two round trips rather than one join: a left join fanning consents
    // out across their scopes would need per-client deduplication in
    // memory anyway, for a subject a caller never has more than a handful
    // of consents for. `grantedAt` is the consent's own `updatedAt` — the
    // one write's own recording is a replacement of the whole granted set
    // (see `record` above), so that is when the grant, as it now reads,
    // became what it currently is.
    async forSubject(subjectId: string): Promise<SubjectConsent[]> {
      const consentRows = await tx
        .select({
          consentId: consents.id,
          clientId: consents.clientId,
          clientKey: clients.clientId,
          grantedAt: consents.updatedAt,
        })
        .from(consents)
        .innerJoin(clients, eq(consents.clientId, clients.id))
        .where(eq(consents.subjectId, subjectId));
      if (consentRows.length === 0) return [];

      const scopeRows = await tx
        .select({ consentId: consentScopes.consentId, name: clientScopes.name })
        .from(consentScopes)
        .innerJoin(clientScopes, eq(consentScopes.clientScopeId, clientScopes.id))
        .where(
          inArray(
            consentScopes.consentId,
            consentRows.map((row) => row.consentId),
          ),
        );
      const scopeNamesByConsent = new Map<string, string[]>();
      for (const row of scopeRows) {
        const existing = scopeNamesByConsent.get(row.consentId) ?? [];
        existing.push(row.name);
        scopeNamesByConsent.set(row.consentId, existing);
      }

      return consentRows.map((row) => ({
        clientId: row.clientId,
        clientKey: row.clientKey,
        scopeNames: scopeNamesByConsent.get(row.consentId) ?? [],
        grantedAt: row.grantedAt,
      }));
    },

    // `consent_scopes` cascades on `consents.id` (packages/db/drizzle/
    // 0046_consents.sql), so deleting the one row here is the whole
    // withdrawal.
    async revoke(subjectId: string, clientId: string): Promise<boolean> {
      const deleted = await tx
        .delete(consents)
        .where(and(eq(consents.subjectId, subjectId), eq(consents.clientId, clientId)))
        .returning({ id: consents.id });
      return deleted.length > 0;
    },
  };
}
