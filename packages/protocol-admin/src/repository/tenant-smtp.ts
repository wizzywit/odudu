import { type TenantScopedDatabase } from '@odudu/db';
import { eq } from 'drizzle-orm';
import { tenantSmtp } from '#/schema/tenant-smtp';

export interface TenantSmtpRecord {
  readonly tenantId: string;
  readonly host: string;
  readonly port: number;
  readonly fromAddress: string;
  readonly username: string | null;
  readonly passwordEncrypted: string | null;
  readonly starttls: boolean;
}

export interface TenantSmtpInput {
  readonly host: string;
  readonly port: number;
  readonly fromAddress: string;
  readonly username: string | null;
  // Already wrapped through `wrapSecret` (@odudu/crypto) by the caller —
  // the repository never sees a plaintext password, the same split
  // `signingKeyRepository` keeps from `generateSigningKey`.
  readonly passwordEncrypted: string | null;
  readonly starttls: boolean;
}

function toRecord(row: typeof tenantSmtp.$inferSelect): TenantSmtpRecord {
  return {
    tenantId: row.tenantId,
    host: row.host,
    port: row.port,
    fromAddress: row.fromAddress,
    username: row.username,
    passwordEncrypted: row.passwordEncrypted,
    starttls: row.starttls,
  };
}

export function tenantSmtpRepository(tx: TenantScopedDatabase) {
  return {
    async byTenantId(tenantId: string): Promise<TenantSmtpRecord | null> {
      const rows = await tx.select().from(tenantSmtp).where(eq(tenantSmtp.tenantId, tenantId));
      const row = rows[0];
      return row === undefined ? null : toRecord(row);
    },

    // A tenant has at most one row, so a repeated PUT narrows or widens
    // it rather than colliding on the primary key — the same
    // insert-or-update shape `assignOrUpdate` (@odudu/domain-tenant) uses
    // for a client's scope assignment.
    async upsert(tenantId: string, input: TenantSmtpInput): Promise<TenantSmtpRecord> {
      const rows = await tx
        .insert(tenantSmtp)
        .values({ tenantId, ...input })
        .onConflictDoUpdate({ target: tenantSmtp.tenantId, set: input })
        .returning();
      const row = rows[0];
      if (row === undefined) {
        throw new Error(`upsert into tenant_smtp for tenant ${tenantId} returned no row`);
      }
      return toRecord(row);
    },

    async delete(tenantId: string): Promise<boolean> {
      const rows = await tx
        .delete(tenantSmtp)
        .where(eq(tenantSmtp.tenantId, tenantId))
        .returning({ tenantId: tenantSmtp.tenantId });
      return rows.length > 0;
    },
  };
}
