import { tenants, type TenantScopedDatabase } from '@odudu/db';
import { eq } from 'drizzle-orm';
import { TENANT_SETTING_COLUMNS, type TenantSettingName } from '#/service/tenant-settings';

type TenantColumn = keyof typeof tenants.$inferSelect;

// `display_name` is the one text setting with no default (schema/tenants.ts),
// so a tenant that never set one reads back `null` here, exactly as the
// column holds it.
export type TenantSettingsRecord = Readonly<
  Record<TenantSettingName, boolean | number | string | null>
>;

/** Thrown by `amend` when a supplied value is refused by a CHECK constraint. */
export class TenantSettingCheckViolationError extends Error {
  constructor() {
    super('a tenant setting value violated a CHECK constraint');
    this.name = 'TenantSettingCheckViolationError';
  }
}

function primitiveColumn(
  row: typeof tenants.$inferSelect,
  column: TenantColumn,
): boolean | number | string | null {
  const value = row[column];
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return value;
  }
  throw new Error(`tenant setting column ${column} is not a primitive`);
}

function toRecord(row: typeof tenants.$inferSelect): TenantSettingsRecord {
  const settings = {} as Record<TenantSettingName, boolean | number | string | null>;
  for (const { name, column } of TENANT_SETTING_COLUMNS) {
    settings[name] = primitiveColumn(row, column);
  }
  return settings;
}

// Drizzle wraps the driver's error, so the SQLSTATE is a level down —
// mirrors `isUniqueViolation` in @odudu/db. Every CHECK on
// `tenants` is hand-named (`tenants_password_min_length_bounds`,
// `tenants_brute_force_bounds`, …) with no shared naming convention to
// parse a column back out of, some naming more than one column, so the
// SQLSTATE alone is the signal; the caller already knows which columns it
// tried to write.
function isCheckViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ('code' in error) return error.code === '23514';
  return 'cause' in error && isCheckViolation(error.cause);
}

export function tenantSettingsRepository(tx: TenantScopedDatabase) {
  return {
    async byId(tenantId: string): Promise<TenantSettingsRecord | null> {
      const rows = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
      const row = rows[0];
      return row === undefined ? null : toRecord(row);
    },

    // `SELECT ... FOR UPDATE`, in the same transaction the caller amends in:
    // an `If-Match` compared against a row another transaction is already
    // rewriting prevents nothing, because both readers match and the second
    // write silently replaces the first.
    async lockById(tenantId: string): Promise<TenantSettingsRecord | null> {
      const rows = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).for('update');
      const row = rows[0];
      return row === undefined ? null : toRecord(row);
    },

    async amend(
      tenantId: string,
      columns: Readonly<Record<string, boolean | number | string>>,
    ): Promise<TenantSettingsRecord> {
      let rows: (typeof tenants.$inferSelect)[];
      try {
        rows = await tx.update(tenants).set(columns).where(eq(tenants.id, tenantId)).returning();
      } catch (error) {
        if (isCheckViolation(error)) throw new TenantSettingCheckViolationError();
        throw error;
      }
      const row = rows[0];
      if (row === undefined) {
        throw new Error(`tenant ${tenantId} not found while amending its settings`);
      }
      return toRecord(row);
    },
  };
}
