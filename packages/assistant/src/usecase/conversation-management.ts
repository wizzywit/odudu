// A person's own conversations: listing them, reopening the latest, hiding one,
// exporting one and deleting one. Every call is for the caller's conversations
// at the tenant the path names, and a conversation that is not theirs is
// reported as not there, whoever it belongs to.
import {
  EXPORT_MESSAGES_MAX,
  type AssistantConversationExport,
  type AssistantConversationSummary,
  type AssistantResumedConversation,
} from '@odudu/contracts/admin';
import {
  conversationRepository,
  type ConversationListRow,
  type ConversationRecord,
} from '#/repository/conversations';
import { leaseRepository } from '#/repository/leases';
import { messageRepository, PAGE_MAX } from '#/repository/messages';
import { tombstoneRepository } from '#/repository/tombstones';
import { decodePosition, encodePosition } from '#/service/activity-position';
import { conversationIsCallers, crossTenant } from '#/service/conversation-access';
import {
  exportDocumentOf,
  exportedMessageOf,
  exportMarkdownOf,
} from '#/service/conversation-export';
import { createMasker } from '#/service/mask-secrets';
import { readSettings } from '#/usecase/settings';
import type { ChatCaller, ChatDeps } from '#/usecase/chat-deps';
import { loadConversation } from '#/usecase/conversations';

function summaryOf(row: ConversationListRow): AssistantConversationSummary {
  return {
    id: row.id,
    title: row.title,
    profile: row.profile,
    mode: row.mode === 'act' ? 'act' : 'ask',
    created_at: row.createdAt.toISOString(),
    last_active_at: row.lastActiveAt.toISOString(),
    archived: row.archivedAt !== null,
    archived_at: row.archivedAt?.toISOString() ?? null,
    reported: row.reportedAt !== null,
    target_tenant_id: row.targetTenantId,
  };
}

// The tenant a caller's list is for: the one the path names when it is not their own.
function targetOf(caller: ChatCaller): string | null {
  return crossTenant(caller) && caller.target !== undefined ? caller.target.id : null;
}

export type ListOutcome =
  | {
      readonly kind: 'ok';
      readonly items: AssistantConversationSummary[];
      readonly next: string | null;
    }
  | { readonly kind: 'invalid_position' };

export interface ListInput {
  readonly archived: boolean;
  /** Where the previous page ended, as `next` said; absent for the first page. */
  readonly after: string | undefined;
  readonly limit: number;
}

/**
 * One page of the caller's own conversations in one of their two lists, newest
 * activity first. The page is one indexed read of at most `limit` rows however
 * many conversations the tenant holds, and never reads another person's.
 */
export async function listConversations(
  deps: ChatDeps,
  caller: ChatCaller,
  input: ListInput,
): Promise<ListOutcome> {
  const after = input.after === undefined ? undefined : decodePosition(input.after);
  if (input.after !== undefined && after === undefined) return { kind: 'invalid_position' };
  const page = await deps.transact(caller.tenantId, (tx) =>
    conversationRepository(tx).listByOwner(caller.ownerSubjectId, {
      archived: input.archived,
      target: targetOf(caller),
      tenant: caller.tenantId,
      after,
      limit: input.limit,
    }),
  );
  return {
    kind: 'ok',
    items: page.items.map(summaryOf),
    next: page.next === null ? null : encodePosition(page.next),
  };
}

/**
 * The caller's most recently active conversation that is not hidden, with its
 * messages, so the console can reopen it after a reload or a sign-in. `null`
 * when they have none. `continuable` says whether a message sent to it would be
 * answered: a conversation whose sign-in ended can be read and not continued.
 */
export async function lastConversation(
  deps: ChatDeps,
  caller: ChatCaller,
): Promise<AssistantResumedConversation | null> {
  const page = await listConversations(deps, caller, {
    archived: false,
    after: undefined,
    limit: 1,
  });
  const row = page.kind === 'ok' ? page.items[0] : undefined;
  if (row === undefined) return null;
  const conversation = await loadConversation(deps, caller, row.id);
  if (conversation === null) return null;
  const continuable = deps.continuable === undefined || (await deps.continuable(caller, row.id));
  return { ...conversation, archived: false, continuable };
}

export type ArchiveOutcome =
  { readonly kind: 'set'; readonly archivedAt: Date | null } | { readonly kind: 'not_found' };

/** Hides the caller's conversation from their list, or brings it back. Removes nothing. */
export async function setArchived(
  deps: ChatDeps,
  caller: ChatCaller,
  id: string,
  archived: boolean,
): Promise<ArchiveOutcome> {
  return deps.transact(caller.tenantId, async (tx) => {
    const repository = conversationRepository(tx);
    const record = await repository.byId(id);
    if (record === undefined || !conversationIsCallers(record, caller)) {
      return { kind: 'not_found' as const };
    }
    const archivedAt = await repository.setArchived(id, archived, deps.now());
    return archivedAt === undefined
      ? { kind: 'not_found' as const }
      : { kind: 'set' as const, archivedAt };
  });
}

export type DeleteOutcome =
  | { readonly kind: 'deleted' }
  | { readonly kind: 'not_found' }
  // A reported conversation is kept for review until an administrator releases it.
  | { readonly kind: 'held' }
  // A turn of it is running now; it is stopped first.
  | { readonly kind: 'busy' }
  | { readonly kind: 'unavailable' };

/**
 * Deletes the caller's own conversation. Its messages, trace and cards go; a
 * tombstone stays (ids, times, who deleted it, the counts and a keyed digest of
 * its messages) and so does the audit row, which holds no text. Refused while
 * the conversation is reported or a turn of it runs. The grant it acted under
 * is ended after the delete commits.
 */
export async function deleteConversation(
  deps: ChatDeps,
  caller: ChatCaller,
  id: string,
): Promise<DeleteOutcome> {
  const ports = deps.conversations;
  if (ports === undefined) return { kind: 'unavailable' };
  const now = deps.now();
  const outcome = await ports.withAudit(caller, async (tx, record): Promise<DeleteOutcome> => {
    // Ownership is settled before the lock, so no one queues behind another person's row.
    const seen = await conversationRepository(tx).byId(id);
    if (seen === undefined || !conversationIsCallers(seen, caller)) return { kind: 'not_found' };
    const row = await conversationRepository(tx).lock(id);
    if (row === undefined || !conversationIsCallers(row, caller)) return { kind: 'not_found' };
    if (row.reportedAt !== null) return { kind: 'held' };
    if (await leaseRepository(tx).liveFor(id, now)) return { kind: 'busy' };
    const left = await tombstoneRepository(tx).erase(
      row,
      caller.ownerSubjectId,
      now,
      ports.digestKey,
    );
    await record({
      action: 'assistant.conversation_deleted',
      conversationId: id,
      ...(row.targetTenantId === null ? {} : { targetTenantId: row.targetTenantId }),
      messageCount: left.messageCount,
      turnCount: left.turnCount,
      digest: left.digest,
    });
    return { kind: 'deleted' };
  });
  if (outcome.kind === 'deleted' && ports.endAccess !== undefined) {
    try {
      await ports.endAccess(caller, id, now);
    } catch (error) {
      deps.log?.('assistant.end_access_failed', {
        conversation: id,
        error: error instanceof Error ? error.name : 'unknown',
      });
    }
  }
  return outcome;
}

export type ExportFormat = 'json' | 'markdown';

export type ExportOutcome =
  | {
      readonly kind: 'ok';
      readonly document: AssistantConversationExport;
      readonly markdown: string | undefined;
    }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'unavailable' };

// Whether the export hides email addresses: the stricter of the tenants involved.
async function masksEmails(deps: ChatDeps, caller: ChatCaller): Promise<boolean> {
  const own = await deps.transact(caller.tenantId, (tx) => readSettings(tx, caller.tenantId));
  if (own.assistant_mask_emails || caller.target === undefined) return own.assistant_mask_emails;
  const target = caller.target.id;
  return (await deps.transact(target, (tx) => readSettings(tx, target))).assistant_mask_emails;
}

/**
 * The caller's own conversation as a document: its fields, and its messages
 * with secrets hidden, the first EXPORT_MESSAGES_MAX of them, read a page at a
 * time so the work and the memory are bounded however long it is. Only the
 * owner has this: there is no route by which anyone else, an operator or an
 * auditor, takes a conversation's text out. The export is an audit row in the
 * transaction that reads it, naming the conversation and how much it carried.
 */
export async function exportConversation(
  deps: ChatDeps,
  caller: ChatCaller,
  id: string,
  format: ExportFormat,
): Promise<ExportOutcome> {
  const ports = deps.conversations;
  if (ports === undefined) return { kind: 'unavailable' };
  const masker = createMasker({ emails: await masksEmails(deps, caller) });
  const now = deps.now();
  return ports.withAudit(caller, async (tx, record): Promise<ExportOutcome> => {
    const row = await conversationRepository(tx).byId(id);
    if (row === undefined || !conversationIsCallers(row, caller)) return { kind: 'not_found' };
    const messages = messageRepository(tx);
    const exported: AssistantConversationExport['messages'] = [];
    let after = 0;
    let truncated = false;
    for (;;) {
      const page = await messages.pageAfter(id, after, PAGE_MAX);
      for (const message of page) {
        const one = exportedMessageOf(message, masker);
        if (one === null) continue;
        if (exported.length >= EXPORT_MESSAGES_MAX) {
          truncated = true;
          break;
        }
        exported.push(one);
      }
      const last = page[page.length - 1];
      if (truncated || last === undefined || page.length < PAGE_MAX) break;
      after = last.seq;
    }
    const document = exportDocumentOf(conversationOf(row), exported, truncated, now);
    await record({
      action: 'assistant.conversation_exported',
      conversationId: id,
      ...(row.targetTenantId === null ? {} : { targetTenantId: row.targetTenantId }),
      format,
      messageCount: exported.length,
      truncated,
    });
    return {
      kind: 'ok',
      document,
      markdown: format === 'markdown' ? exportMarkdownOf(document) : undefined,
    };
  });
}

function conversationOf(row: ConversationRecord): AssistantConversationExport['conversation'] {
  return {
    id: row.id,
    title: row.title,
    profile: row.profile,
    mode: row.mode === 'act' ? 'act' : 'ask',
    created_at: row.createdAt.toISOString(),
    last_active_at: row.lastActiveAt.toISOString(),
  };
}
