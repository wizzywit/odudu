import {
  type AssistantActivityConversation,
  type AssistantActivityReplay,
  type AssistantPromptfooCase,
  type ListAssistantActivityQuery,
} from '@odudu/contracts/admin';
import { type TenantScopedDatabase } from '@odudu/db';
import { userRepository } from '@odudu/domain-identity';
import { type AssistantSettingsStore } from '#/usecase/assistant-settings';
import { decodeCursor, encodeCursor, filterDigest } from '#/service/cursor';

type Filters = Omit<ListAssistantActivityQuery, 'cursor' | 'limit'>;

export interface ActivityPage {
  readonly items: AssistantActivityConversation[];
  readonly next: string | null;
}

export type ReportResult =
  | { readonly kind: 'reported'; readonly at: Date; readonly count: number }
  | { readonly kind: 'already'; readonly at: Date; readonly count: number }
  | { readonly kind: 'full' }
  | { readonly kind: 'missing' };

// The conversations and the trace beneath them, which the assistant package
// owns and this one may not import: the composition root hands them over.
export interface AssistantActivityStore {
  /** `undefined` for a cursor the list did not write. */
  list(
    tx: TenantScopedDatabase,
    filters: Filters,
    cursor: string | undefined,
    limit: number,
  ): Promise<ActivityPage | undefined>;
  replay(
    tx: TenantScopedDatabase,
    tenantId: string,
    id: string,
    text: boolean,
  ): Promise<AssistantActivityReplay | null>;
  export(
    tx: TenantScopedDatabase,
    tenantId: string,
    id: string,
    text: boolean,
  ): Promise<AssistantPromptfooCase | null>;
  report(
    tx: TenantScopedDatabase,
    input: {
      readonly conversationId: string;
      readonly subjectId: string;
      readonly mayReadOthers: boolean;
      readonly now: Date;
    },
  ): Promise<ReportResult>;
}

export interface ReportAuditEvent {
  readonly action: 'assistant.report' | 'assistant.text_read';
  readonly resourceType: 'assistant_conversation';
  readonly resourceId: string;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
  readonly outcome: 'allowed';
  readonly detail: Record<string, unknown>;
}

export type ReportAudit = (tx: TenantScopedDatabase, event: ReportAuditEvent) => Promise<void>;

/** Who is reading, for the record a read of text leaves. */
export interface Reader {
  readonly subjectId: string;
  readonly tenantId: string;
  readonly clientId: string;
}

export interface AssistantActivityDeps {
  readonly store: AssistantActivityStore;
  readonly settings: AssistantSettingsStore;
  readonly cursorKey: Uint8Array;
  readonly audit: ReportAudit;
  readonly now: () => Date;
}

const COLLECTION = 'assistant-activity';

// A conversation's id is a UUID; anything else names none, and the database is
// not asked about it.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
export function isConversationId(value: string | undefined): value is string {
  return value !== undefined && UUID.test(value);
}

// Whether people who hold `read-assistant-activity` may read the text of
// conversations: the tenant chose it. Without it they read the metadata only.
export async function auditorsMaySee(
  deps: Pick<AssistantActivityDeps, 'settings'>,
  tx: TenantScopedDatabase,
  tenantId: string,
): Promise<boolean> {
  return (await deps.settings.read(tx, tenantId)).assistant_auditor_visible;
}

function digestOf(filters: Filters): string {
  return filterDigest({
    person: filters.person,
    conversation: filters.conversation,
    tool: filters.tool,
    outcome: filters.outcome,
    kind: filters.kind,
  });
}

export interface ListActivityInput {
  readonly tenantId: string;
  readonly filters: Filters;
  readonly limit: number;
  readonly cursor: string | undefined;
}

export type ListActivityOutcome =
  | { readonly kind: 'invalid_cursor' }
  | {
      readonly kind: 'ok';
      readonly items: AssistantActivityConversation[];
      readonly next: string | null;
    };

export async function listAssistantActivity(
  deps: AssistantActivityDeps,
  tx: TenantScopedDatabase,
  input: ListActivityInput,
): Promise<ListActivityOutcome> {
  let position: string | undefined;
  if (input.cursor !== undefined) {
    const decoded = decodeCursor(
      deps.cursorKey,
      COLLECTION,
      input.tenantId,
      digestOf(input.filters),
      input.cursor,
    );
    if (decoded.kind === 'invalid') return { kind: 'invalid_cursor' };
    position = decoded.after;
  }
  const page = await deps.store.list(tx, input.filters, position, input.limit);
  if (page === undefined) return { kind: 'invalid_cursor' };
  const names = await userRepository(tx).usernamesOf([
    ...new Set(page.items.map((item) => item.person)),
  ]);
  return {
    kind: 'ok',
    items: page.items.map((item) => ({ ...item, person_username: names.get(item.person) ?? null })),
    next:
      page.next === null
        ? null
        : encodeCursor(deps.cursorKey, {
            after: page.next,
            collection: COLLECTION,
            tenantId: input.tenantId,
            filters: digestOf(input.filters),
          }),
  };
}

export type ReadOutcome<T> =
  { readonly kind: 'not_found' } | { readonly kind: 'ok'; readonly value: T };

// A read that returned text is recorded, in the reader's transaction, unless
// the reader is the person it belongs to. The record names who read which
// conversation, whose it is and which part, never the text.
async function recordTextRead(
  deps: AssistantActivityDeps,
  tx: TenantScopedDatabase,
  reader: Reader,
  conversation: { readonly id: string; readonly person: string },
  tenantId: string,
  part: 'replay' | 'export',
): Promise<void> {
  if (reader.tenantId === tenantId && reader.subjectId === conversation.person) return;
  await deps.audit(tx, {
    action: 'assistant.text_read',
    resourceType: 'assistant_conversation',
    resourceId: conversation.id,
    actorSubjectId: reader.subjectId,
    actorTenantId: reader.tenantId,
    actorClientId: reader.clientId,
    outcome: 'allowed',
    detail: { tenant: tenantId, conversation: conversation.id, owner: conversation.person, part },
  });
}

export async function replayAssistantConversation(
  deps: AssistantActivityDeps,
  tx: TenantScopedDatabase,
  tenantId: string,
  id: string,
  reader: Reader,
): Promise<ReadOutcome<AssistantActivityReplay>> {
  const text = await auditorsMaySee(deps, tx, tenantId);
  const replay = await deps.store.replay(tx, tenantId, id, text);
  if (replay === null) return { kind: 'not_found' };
  if (text) await recordTextRead(deps, tx, reader, replay.conversation, tenantId, 'replay');
  const names = await userRepository(tx).usernamesOf([replay.conversation.person]);
  return {
    kind: 'ok',
    value: {
      ...replay,
      conversation: {
        ...replay.conversation,
        person_username: names.get(replay.conversation.person) ?? null,
      },
    },
  };
}

export async function exportAssistantConversation(
  deps: AssistantActivityDeps,
  tx: TenantScopedDatabase,
  tenantId: string,
  id: string,
  reader: Reader,
): Promise<ReadOutcome<AssistantPromptfooCase>> {
  const text = await auditorsMaySee(deps, tx, tenantId);
  const exported = await deps.store.export(tx, tenantId, id, text);
  if (exported === null) return { kind: 'not_found' };
  if (text) {
    // The export names its conversation; the owner is whoever the replay's header says.
    const header = await deps.store.replay(tx, tenantId, id, false);
    if (header !== null) {
      await recordTextRead(deps, tx, reader, header.conversation, tenantId, 'export');
    }
  }
  return { kind: 'ok', value: exported };
}

export interface ReportInput {
  readonly tenantId: string;
  readonly conversationId: string;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
  readonly holdsActivityCapability: boolean;
}

export type ReportOutcome =
  | { readonly kind: 'ok'; readonly at: Date; readonly count: number }
  | { readonly kind: 'full' }
  | { readonly kind: 'not_found' };

/**
 * Keeps a conversation past retention. The person it belongs to may report it
 * whatever the tenant's auditor setting says; someone who only holds
 * `read-assistant-activity` may report others' while that setting lets them
 * read them. A report that took effect leaves an `assistant.report` event in
 * the same transaction, and one that changed nothing leaves none.
 */
export async function reportAssistantConversation(
  deps: AssistantActivityDeps,
  tx: TenantScopedDatabase,
  input: ReportInput,
): Promise<ReportOutcome> {
  // Reporting shows no text, so whoever may read the metadata may report.
  const mayReadOthers = input.holdsActivityCapability;
  // Only a person of this tenant has a conversation in it.
  const subjectId = input.actorTenantId === input.tenantId ? input.actorSubjectId : '';
  const result = await deps.store.report(tx, {
    conversationId: input.conversationId,
    subjectId,
    mayReadOthers,
    now: deps.now(),
  });
  if (result.kind === 'missing') return { kind: 'not_found' };
  if (result.kind === 'full') return result;
  if (result.kind === 'reported') {
    await deps.audit(tx, {
      action: 'assistant.report',
      resourceType: 'assistant_conversation',
      resourceId: input.conversationId,
      actorSubjectId: input.actorSubjectId,
      actorTenantId: input.actorTenantId,
      actorClientId: input.actorClientId,
      outcome: 'allowed',
      detail: { tenant: input.tenantId, conversation: input.conversationId },
    });
  }
  return { kind: 'ok', at: result.at, count: result.count };
}
