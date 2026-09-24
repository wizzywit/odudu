import { type TenantScopedDatabase } from '@odudu/db';
import {
  coerceTenantSetting,
  TENANT_SETTING_NAMES,
  tenantSettingsRepository,
  TenantSettingCheckViolationError,
  type TenantSettingsRecord,
} from '@odudu/domain-tenant';
import { etagOf, matches } from '#/service/etag';

export interface SettingsAuditEvent {
  readonly action: 'tenant.amend_settings';
  readonly resourceType: 'tenant';
  readonly resourceId: string;
  readonly actorSubjectId: string;
}

/** See `Audit` in `#/usecase/tenants.ts` — the same no-op-until-a-real-sink seam. */
export type Audit = (event: SettingsAuditEvent) => Promise<void>;

export interface ReadSettingsResult {
  readonly settings: TenantSettingsRecord;
  readonly etag: string;
}

export async function readSettings(
  tx: TenantScopedDatabase,
  tenantId: string,
): Promise<ReadSettingsResult> {
  const settings = await tenantSettingsRepository(tx).byId(tenantId);
  if (settings === null) {
    throw new Error(`tenant ${tenantId} has no settings row`);
  }
  return { settings, etag: etagOf(settings) };
}

export interface AmendSettingsInput {
  readonly tenantId: string;
  readonly values: Readonly<Record<string, boolean | number | string>>;
  readonly ifMatch: string | undefined;
  readonly actorSubjectId: string;
}

export interface AmendSettingsDeps {
  readonly audit: Audit;
}

export type AmendSettingsOutcome =
  | { kind: 'amended'; settings: TenantSettingsRecord; etag: string }
  | { kind: 'unknown_setting'; name: string; known: readonly string[] }
  | { kind: 'invalid_value'; name: string; expected: 'boolean' | 'integer' | 'text' }
  | { kind: 'precondition_failed' };

// Thrown, never returned: by the time the CHECK fires, the UPDATE has
// already left Postgres refusing every further statement on this
// connection until a ROLLBACK, which is what throwing out of `withTenant`'s
// transaction triggers, rather than trying to recover and continue inside
// an already-aborted one. `settingNames` is every name this request
// supplied — a CHECK's own name does not reliably map back to one column
// (some name more than one), so a request that touched more than one
// setting cannot say which of them was refused.
export class AmendSettingsRefusedError extends Error {
  readonly settingNames: readonly string[];

  constructor(settingNames: readonly string[]) {
    super(`tenant setting ${settingNames.join(', ')} refused that value`);
    this.name = 'AmendSettingsRefusedError';
    this.settingNames = settingNames;
  }
}

interface CoercedSetting {
  readonly name: string;
  readonly column: string;
  readonly value: boolean | number | string;
}

type CoerceAllResult = { kind: 'ok'; settings: readonly CoercedSetting[] } | AmendSettingsOutcome;

// Every supplied name goes through `coerceTenantSetting` — the same map
// `seed tenant --set` applies through — before any of them touches the
// database, so a typo in the second field never leaves the first applied.
function coerceAll(values: Readonly<Record<string, boolean | number | string>>): CoerceAllResult {
  const settings: CoercedSetting[] = [];
  for (const [name, raw] of Object.entries(values)) {
    const outcome = coerceTenantSetting(name, String(raw));
    if (outcome.kind === 'unknown_setting') {
      return { kind: 'unknown_setting', name, known: TENANT_SETTING_NAMES };
    }
    if (outcome.kind === 'invalid_value') {
      return { kind: 'invalid_value', name, expected: outcome.expected };
    }
    settings.push({ name, column: outcome.column, value: outcome.value });
  }
  return { kind: 'ok', settings };
}

export async function amendSettings(
  tx: TenantScopedDatabase,
  deps: AmendSettingsDeps,
  input: AmendSettingsInput,
): Promise<AmendSettingsOutcome> {
  const coerced = coerceAll(input.values);
  if (coerced.kind !== 'ok') return coerced;

  const current = await readSettings(tx, input.tenantId);
  if (matches(input.ifMatch, current.etag) === 'mismatch') {
    return { kind: 'precondition_failed' };
  }

  const columns = Object.fromEntries(
    coerced.settings.map((setting) => [setting.column, setting.value]),
  );

  let settings: TenantSettingsRecord;
  try {
    settings = await tenantSettingsRepository(tx).amend(input.tenantId, columns);
  } catch (error) {
    if (error instanceof TenantSettingCheckViolationError) {
      throw new AmendSettingsRefusedError(coerced.settings.map((setting) => setting.name));
    }
    throw error;
  }

  await deps.audit({
    action: 'tenant.amend_settings',
    resourceType: 'tenant',
    resourceId: input.tenantId,
    actorSubjectId: input.actorSubjectId,
  });

  return { kind: 'amended', settings, etag: etagOf(settings) };
}
