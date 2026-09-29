import { type TenantScopedDatabase } from '@odudu/db';
import {
  isSystemTenantId,
  SYSTEM_TENANT_DISABLE_REFUSED,
  coerceTenantSetting,
  TENANT_SETTING_NAMES,
  tenantSettingsRepository,
  TenantSettingCheckViolationError,
  tenantSettingProblems,
  type TenantSettingProblem,
  type TenantSettingsRecord,
} from '@odudu/domain-tenant';
import { etagOf, matches } from '#/service/etag';
import { endSessionsOfDisabledTenant } from '#/usecase/end-sessions';

export interface SettingsAuditEvent {
  readonly action: 'tenant.amend_settings';
  readonly resourceType: 'tenant';
  readonly resourceId: string;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
  readonly outcome: 'allowed' | 'refused' | 'failed';
  readonly detail?: Record<string, unknown>;
}

/** See `Audit` in `#/usecase/tenants.ts` — the same transactional write. */
export type Audit = (tx: TenantScopedDatabase, event: SettingsAuditEvent) => Promise<void>;

export interface ReadSettingsResult {
  readonly settings: TenantSettingsRecord;
  readonly etag: string;
}

function toResult(tenantId: string, settings: TenantSettingsRecord | null): ReadSettingsResult {
  if (settings === null) {
    throw new Error(`tenant ${tenantId} has no settings row`);
  }
  return { settings, etag: etagOf(settings) };
}

export async function readSettings(
  tx: TenantScopedDatabase,
  tenantId: string,
): Promise<ReadSettingsResult> {
  return toResult(tenantId, await tenantSettingsRepository(tx).byId(tenantId));
}

export interface AmendSettingsInput {
  readonly tenantId: string;
  /** Where the Logout Tokens a disable queues say they come from. */
  readonly issuer: string;
  readonly now: Date;
  readonly values: Readonly<Record<string, boolean | number | string>>;
  readonly ifMatch: string | undefined;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export interface AmendSettingsDeps {
  readonly audit: Audit;
  readonly kek: Uint8Array;
}

export type AmendSettingsOutcome =
  | { kind: 'amended'; settings: TenantSettingsRecord; etag: string }
  | { kind: 'unknown_setting'; name: string; known: readonly string[] }
  | {
      kind: 'invalid_value';
      name: string;
      expected: 'boolean' | 'integer' | 'text';
      values?: readonly string[];
    }
  | { kind: 'out_of_range'; problems: readonly TenantSettingProblem[] }
  | { kind: 'system_tenant_guarded'; reason: string }
  | { kind: 'precondition_failed' };

// A backstop: `tenantSettingProblems` refuses every range first. Thrown,
// never returned: by the time the CHECK fires, the UPDATE has left Postgres
// refusing every further statement until a ROLLBACK, which throwing out of
// `withTenant`'s transaction triggers. `settingNames` is every name this
// request supplied — a CHECK's own name does not reliably map back to one
// column, so a request touching several cannot say which was refused.
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
      return {
        kind: 'invalid_value',
        name,
        expected: outcome.expected,
        ...(outcome.values === undefined ? {} : { values: outcome.values }),
      };
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

  // The same refusal `amendTenant` gives, because this route writes the same
  // `tenants.enabled` column through a different door.
  const disabling = coerced.settings.find(
    (setting) => setting.column === 'enabled' && setting.value === false,
  );
  if (disabling !== undefined && isSystemTenantId(input.tenantId)) {
    const reason = SYSTEM_TENANT_DISABLE_REFUSED;
    await deps.audit(tx, {
      action: 'tenant.amend_settings',
      resourceType: 'tenant',
      resourceId: input.tenantId,
      actorSubjectId: input.actorSubjectId,
      actorTenantId: input.actorTenantId,
      actorClientId: input.actorClientId,
      outcome: 'refused',
      detail: { reason },
    });
    return { kind: 'system_tenant_guarded', reason };
  }

  // Locked, not merely read: the comparison and the UPDATE below have to be
  // the only ones running against this row, or two callers holding the same
  // `If-Match` both match and the later write replaces the earlier with no
  // sign to either of them.
  const current = toResult(
    input.tenantId,
    await tenantSettingsRepository(tx).lockById(input.tenantId),
  );
  if (matches(input.ifMatch, current.etag) === 'mismatch') {
    return { kind: 'precondition_failed' };
  }

  // The request schema admits `{}` and Drizzle refuses an empty `set`, so a
  // caller sending one would be told the server broke for a request the
  // schema accepted. Answered after the precondition, so `If-Match` still
  // decides whether the caller was looking at the row it is being shown.
  if (coerced.settings.length === 0) {
    return { kind: 'amended', settings: current.settings, etag: current.etag };
  }

  // Judged over the stored row with the patch laid on it, so a patch that
  // moves only an idle lifetime is held to the maximum already stored.
  const problems = tenantSettingProblems({
    ...current.settings,
    ...Object.fromEntries(coerced.settings.map((setting) => [setting.name, setting.value])),
  });
  if (problems.length > 0) return { kind: 'out_of_range', problems };

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

  const sessionsEnded =
    current.settings.enabled === true && settings.enabled === false
      ? await endSessionsOfDisabledTenant(tx, deps, input)
      : undefined;

  await deps.audit(tx, {
    action: 'tenant.amend_settings',
    resourceType: 'tenant',
    resourceId: input.tenantId,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
    ...(sessionsEnded === undefined ? {} : { detail: { sessions_ended: sessionsEnded } }),
  });

  return { kind: 'amended', settings, etag: etagOf(settings) };
}
