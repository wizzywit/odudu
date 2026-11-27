import { type AssistantSettings } from '@odudu/contracts/admin';
import { type TenantScopedDatabase } from '@odudu/db';
import { redactedDiff } from '#/service/audit-detail';
import { etagOf, matches } from '#/service/etag';

export interface AssistantSettingsAuditEvent {
  readonly action: 'assistant.config';
  readonly resourceType: 'assistant_settings';
  readonly resourceId: string;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
  readonly outcome: 'allowed' | 'refused' | 'failed';
  readonly detail?: Record<string, unknown>;
}

/** See `Audit` in `#/usecase/tenants.ts`: the same transactional write. */
export type Audit = (tx: TenantScopedDatabase, event: AssistantSettingsAuditEvent) => Promise<void>;

// The storage the assistant package owns, handed over by the composition
// root because this package may not import it.
export interface AssistantSettingsStore {
  read(tx: TenantScopedDatabase, tenantId: string): Promise<AssistantSettings>;
  write(
    tx: TenantScopedDatabase,
    tenantId: string,
    settings: AssistantSettings,
    now: Date,
  ): Promise<void>;
}

export interface AssistantSettingsDeps {
  readonly store: AssistantSettingsStore;
  readonly audit: Audit;
  // Takes the tenant's row lock, so that what follows reads and replaces the
  // settings with no other save in between (the tenants row, because the
  // settings row may not exist yet).
  readonly lock: (tx: TenantScopedDatabase, tenantId: string) => Promise<void>;
  readonly now: () => Date;
}

export interface ReadAssistantSettingsResult {
  readonly settings: AssistantSettings;
  readonly etag: string;
}

export interface PutAssistantSettingsInput {
  readonly tenantId: string;
  readonly settings: AssistantSettings;
  // Optional: a caller that read the document first sends the ETag it read,
  // and a save over a newer one is refused rather than overwritten.
  readonly ifMatch?: string | undefined;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export type PutAssistantSettingsOutcome =
  | { readonly kind: 'stored'; readonly settings: AssistantSettings; readonly etag: string }
  | { readonly kind: 'precondition_failed' };

export async function readAssistantSettings(
  deps: Pick<AssistantSettingsDeps, 'store'>,
  tx: TenantScopedDatabase,
  tenantId: string,
): Promise<ReadAssistantSettingsResult> {
  const settings = await deps.store.read(tx, tenantId);
  return { settings, etag: etagOf(settings) };
}

/**
 * Replaces the tenant's settings. The audit row is written in the same
 * transaction, so a change whose row cannot be written does not happen, and a
 * save that changes nothing leaves neither a write nor a row.
 */
export async function putAssistantSettings(
  deps: AssistantSettingsDeps,
  tx: TenantScopedDatabase,
  input: PutAssistantSettingsInput,
): Promise<PutAssistantSettingsOutcome> {
  await deps.lock(tx, input.tenantId);
  const before = await deps.store.read(tx, input.tenantId);
  if (matches(input.ifMatch, etagOf(before)) === 'mismatch') {
    return { kind: 'precondition_failed' };
  }
  const detail = redactedDiff('assistant_settings', before, input.settings);
  if (Object.keys(detail).length === 0) {
    return { kind: 'stored', settings: before, etag: etagOf(before) };
  }
  await deps.store.write(tx, input.tenantId, input.settings, deps.now());
  await deps.audit(tx, {
    action: 'assistant.config',
    resourceType: 'assistant_settings',
    resourceId: input.tenantId,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
    detail,
  });
  return { kind: 'stored', settings: input.settings, etag: etagOf(input.settings) };
}
