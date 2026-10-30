import { type ListMessageOverridesQuery, type MessageOverride } from '@odudu/contracts/admin';
import { canonicalLocale } from '@odudu/contracts';
import { type TenantScopedDatabase } from '@odudu/db';
import { messageOverrideRepository, type MessageOverrideRecord } from '@odudu/domain-tenant';
import { decodeCursor, encodeCursor, filterDigest } from '#/service/cursor';
import {
  messageOverrideEtag,
  overrideConditionHolds,
  type OverrideCondition,
} from '#/service/message-override-condition';

const COLLECTION = 'message-overrides';

export interface MessageOverrideAuditEvent {
  readonly action: 'message_override.set' | 'message_override.delete';
  readonly resourceType: 'message_override';
  readonly resourceId: string;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
  readonly outcome: 'allowed' | 'refused' | 'failed';
  readonly detail?: Record<string, unknown>;
}

/** See `Audit` in `#/usecase/tenants.ts`: the same transactional write. */
export type Audit = (tx: TenantScopedDatabase, event: MessageOverrideAuditEvent) => Promise<void>;

export interface MessageOverrideDeps {
  readonly audit: Audit;
  // Whether a key is an entry of the English catalogue of a page, and what is
  // wrong with a message as text to show; the packages that own the catalogues
  // answer both, since this one may not import them.
  readonly isKnownKey: (key: string) => boolean;
  readonly messageProblem: (key: string, message: string) => string | null;
}

export interface Actor {
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export function messageOverrideWireShape(row: MessageOverrideRecord): MessageOverride {
  return {
    locale: row.locale,
    key: row.key,
    message: row.message,
    updated_at: row.updatedAt.toISOString(),
    etag: messageOverrideEtag(row),
  };
}

export type ListMessageOverridesInput = ListMessageOverridesQuery & {
  readonly limit: number;
  readonly cursorKey: Uint8Array;
  readonly tenantId: string;
};

export type ListMessageOverridesOutcome =
  | { kind: 'invalid_cursor' }
  | { kind: 'ok'; items: readonly MessageOverride[]; next: string | null };

// Paged by key: `after` is a plain `key > after` in the repository's own SQL,
// so a page anchored on an override since deleted resumes from the same place.
export async function listMessageOverrides(
  deps: Pick<MessageOverrideDeps, 'isKnownKey'>,
  tx: TenantScopedDatabase,
  input: ListMessageOverridesInput,
): Promise<ListMessageOverridesOutcome> {
  const filters = filterDigest({ locale: input.locale });
  let after: string | undefined;
  if (input.cursor !== undefined) {
    const decoded = decodeCursor(
      input.cursorKey,
      COLLECTION,
      input.tenantId,
      filters,
      input.cursor,
    );
    if (decoded.kind === 'invalid') return { kind: 'invalid_cursor' };
    after = decoded.after;
  }
  const rows = await messageOverrideRepository(tx, { isKnownKey: deps.isKnownKey }).list(
    input.tenantId,
    input.locale,
    { after, limit: input.limit + 1 },
  );
  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;
  const last = page[page.length - 1];
  const next =
    hasMore && last !== undefined
      ? encodeCursor(input.cursorKey, {
          after: last.key,
          collection: COLLECTION,
          tenantId: input.tenantId,
          filters,
        })
      : null;
  return { kind: 'ok', items: page.map(messageOverrideWireShape), next };
}

export interface PutMessageOverrideInput extends Actor {
  readonly tenantId: string;
  readonly locale: string;
  readonly key: string;
  readonly message: string;
  readonly condition: Exclude<OverrideCondition, { kind: 'required' }>;
}

export type PutMessageOverrideOutcome =
  | { kind: 'put'; override: MessageOverride }
  | { kind: 'precondition_failed' }
  | { kind: 'unknown_key' }
  | { kind: 'invalid_message'; problem: string }
  | { kind: 'over_bound' };

export async function putMessageOverride(
  deps: MessageOverrideDeps,
  tx: TenantScopedDatabase,
  input: PutMessageOverrideInput,
): Promise<PutMessageOverrideOutcome> {
  const problem = deps.messageProblem(input.key, input.message);
  if (problem !== null) return { kind: 'invalid_message', problem };
  const repository = messageOverrideRepository(tx, { isKnownKey: deps.isKnownKey });
  const outcome = await repository.put(
    {
      tenantId: input.tenantId,
      locale: input.locale,
      key: input.key,
      message: input.message,
    },
    (stored) => overrideConditionHolds(input.condition, stored),
  );
  if (outcome === 'precondition_failed') return { kind: 'precondition_failed' };
  if (outcome === 'unknown_key') return { kind: 'unknown_key' };
  if (outcome === 'over_bound') return { kind: 'over_bound' };
  // The path's locale passed the shape check, so the repository cannot refuse it.
  if (outcome === 'invalid_locale') throw new Error('a validated locale was refused');
  const stored = await repository.get(input.tenantId, input.locale, input.key);
  if (stored === null) throw new Error('a message override was not found after it was written');
  await deps.audit(tx, {
    action: 'message_override.set',
    resourceType: 'message_override',
    resourceId: `${stored.locale}/${stored.key}`,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
    detail: { locale: stored.locale, key: stored.key, message_length: stored.message.length },
  });
  return { kind: 'put', override: messageOverrideWireShape(stored) };
}

export interface DeleteMessageOverrideInput extends Actor {
  readonly tenantId: string;
  readonly locale: string;
  readonly key: string;
  readonly ifMatch: string;
}

export type DeleteMessageOverrideOutcome =
  { kind: 'not_found' } | { kind: 'precondition_failed' } | { kind: 'deleted' };

export async function deleteMessageOverride(
  deps: Pick<MessageOverrideDeps, 'audit' | 'isKnownKey'>,
  tx: TenantScopedDatabase,
  input: DeleteMessageOverrideInput,
): Promise<DeleteMessageOverrideOutcome> {
  const locale = canonicalLocale(input.locale) ?? input.locale;
  const removed = await messageOverrideRepository(tx, { isKnownKey: deps.isKnownKey }).delete(
    input.tenantId,
    locale,
    input.key,
    (stored) => overrideConditionHolds({ kind: 'replace', ifMatch: input.ifMatch }, stored),
  );
  if (removed !== 'deleted') return { kind: removed };
  await deps.audit(tx, {
    action: 'message_override.delete',
    resourceType: 'message_override',
    resourceId: `${locale}/${input.key}`,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
    detail: { locale, key: input.key },
  });
  return { kind: 'deleted' };
}
