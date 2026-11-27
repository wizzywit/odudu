import { expect, it } from 'vitest';
import {
  archivedLabel,
  conversationRowOf,
  groupConversations,
  sectionOf,
} from '#/widgets/assistant-panel/services/conversationRows';
import type { AssistantConversationSummary } from '#/widgets/assistant-panel/types/contracts';

function summary(
  id: string,
  lastActive: string,
  extra: Partial<AssistantConversationSummary> = {},
): AssistantConversationSummary {
  return {
    id,
    title: `Title ${id}`,
    profile: 'free-chat',
    mode: 'ask',
    created_at: lastActive,
    last_active_at: lastActive,
    archived: false,
    archived_at: null,
    reported: false,
    target_tenant_id: null,
    ...extra,
  };
}

const NOW = new Date(2026, 10, 26, 15, 0, 0);

function local(day: number, hour: number): string {
  return new Date(2026, 10, day, hour, 0, 0).toISOString();
}

it('words a row: its title, its mode, and the tenant only for one about another tenant', () => {
  const own = conversationRowOf(summary('a', local(26, 9)), null);
  expect(own).toMatchObject({
    id: 'a',
    title: 'Title a',
    modeLabel: 'Ask',
    tenant: null,
    menuLabel: 'Actions for Title a',
  });
  const other = conversationRowOf(
    summary('b', local(26, 9), { mode: 'act', target_tenant_id: 'tenant-id' }),
    'demo',
  );
  expect(other).toMatchObject({ modeLabel: 'Act', tenant: 'demo' });
});

it('gives a conversation with no title a plain name', () => {
  expect(conversationRowOf(summary('a', local(26, 9), { title: null }), null).title).toBe(
    'Untitled conversation',
  );
});

it('groups by the person’s own calendar day, newest group first, and skips an empty group', () => {
  const rows = [
    summary('today', local(26, 8)),
    summary('yesterday', local(25, 23)),
    summary('week', local(22, 10)),
    summary('earlier', local(10, 10)),
  ].map((item) => conversationRowOf(item, null));
  const groups = groupConversations(rows, NOW);
  expect(groups.map((group) => [group.id, group.label, group.rows.map((row) => row.id)])).toEqual([
    ['today', 'Today', ['today']],
    ['yesterday', 'Yesterday', ['yesterday']],
    ['week', 'Earlier this week', ['week']],
    ['earlier', 'Earlier', ['earlier']],
  ]);
  expect(groupConversations(rows.slice(0, 1), NOW).map((group) => group.id)).toEqual(['today']);
  expect(groupConversations([], NOW)).toEqual([]);
});

it('keeps the order it was given inside a group', () => {
  const rows = [summary('1', local(26, 14)), summary('2', local(26, 9))].map((item) =>
    conversationRowOf(item, null),
  );
  expect(groupConversations(rows, NOW)[0]?.rows.map((row) => row.id)).toEqual(['1', '2']);
});

it('draws a list as rows, says when more exist, and reads a refusal as a failure', () => {
  const none = () => undefined;
  const list = {
    status: 'ready' as const,
    rows: [summary('a', local(26, 9))],
    next: 'n1',
    loadLimited: false,
    loadingMore: false,
    loadMoreFailed: true,
    loadMore: none,
    retry: none,
  };
  expect(sectionOf(list, null)).toMatchObject({
    status: 'ready',
    rows: [{ id: 'a' }],
    more: true,
    moreFailed: true,
  });
  expect(sectionOf({ ...list, next: null }, null).more).toBe(false);
  expect(sectionOf({ ...list, status: 'refused' }, null).status).toBe('failed');
});

it('counts the archived ones, with a plus where more exist than were read', () => {
  const one = [conversationRowOf(summary('a', local(26, 9)), null)];
  expect(archivedLabel({ rows: one, more: false })).toBe('Archived (1)');
  expect(archivedLabel({ rows: one, more: true })).toBe('Archived (1+)');
});

it('puts a time in the future with today', () => {
  const rows = [conversationRowOf(summary('f', local(27, 9)), null)];
  expect(groupConversations(rows, NOW)[0]?.id).toBe('today');
});
