import type { AssistantConversationSummary } from '#/widgets/assistant-panel/types/contracts';
import { PANEL_WORDING } from '#/widgets/assistant-panel/services/wording';
import type { AssistantMode } from '#/widgets/assistant-panel/types/chat';
import type {
  ConversationGroup,
  ConversationGroupId,
  ConversationRow,
  ConversationSection,
} from '#/widgets/assistant-panel/types/conversations';

const MODE_LABELS: Readonly<Record<AssistantMode, string>> = {
  ask: PANEL_WORDING.modeAsk,
  act: PANEL_WORDING.modeAct,
};

const GROUPS: readonly { id: ConversationGroupId; label: string }[] = [
  { id: 'today', label: PANEL_WORDING.groupToday },
  { id: 'yesterday', label: PANEL_WORDING.groupYesterday },
  { id: 'week', label: PANEL_WORDING.groupWeek },
  { id: 'earlier', label: PANEL_WORDING.groupEarlier },
];

// The listed conversations are the person's own, and they are listed for one
// tenant, so a row names a tenant only where it is about another one.
export function conversationRowOf(
  summary: AssistantConversationSummary,
  actingIn: string | null,
): ConversationRow {
  const title = summary.title ?? PANEL_WORDING.untitledConversation;
  return {
    id: summary.id,
    title,
    lastActiveAt: summary.last_active_at,
    mode: summary.mode,
    modeLabel: MODE_LABELS[summary.mode],
    tenant: summary.target_tenant_id === null ? null : actingIn,
    archived: summary.archived,
    reported: summary.reported,
    menuLabel: `Actions for ${title}`,
  };
}

interface PagedList {
  status: 'loading' | 'failed' | 'refused' | 'ready';
  rows: readonly AssistantConversationSummary[];
  next: string | null;
  loadLimited: boolean;
  loadingMore: boolean;
  loadMoreFailed: boolean;
  loadMore: () => void;
  retry: () => void;
}

// A list as the view draws it. A refusal reads as a failure: the person has no
// other way to get at their own conversations than to try again.
export function sectionOf(list: PagedList, actingIn: string | null): ConversationSection {
  return {
    status: list.status === 'refused' ? 'failed' : list.status,
    rows: list.rows.map((summary) => conversationRowOf(summary, actingIn)),
    more: list.next !== null,
    loadingMore: list.loadingMore,
    moreFailed: list.loadMoreFailed,
    limited: list.loadLimited,
    loadMore: list.loadMore,
    retry: list.retry,
  };
}

// The disclosure's label: how many archived conversations are known, and a
// plus where there are more than the page read.
export function archivedLabel(section: Pick<ConversationSection, 'rows' | 'more'>): string {
  return `${PANEL_WORDING.archivedTitle} (${String(section.rows.length)}${section.more ? '+' : ''})`;
}

const DAY_MS = 86_400_000;

// Whole calendar days from `then` to `now` in the reader's own time zone, so a
// conversation from last night is "Yesterday" at breakfast, not "Today".
function daysAgo(then: Date, now: Date): number {
  const start = (day: Date): number => Date.UTC(day.getFullYear(), day.getMonth(), day.getDate());
  return Math.round((start(now) - start(then)) / DAY_MS);
}

function groupOf(days: number): ConversationGroupId {
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return days < 7 ? 'week' : 'earlier';
}

// Rows in the order given (newest first), under Today, Yesterday, Earlier this
// week and Earlier; a group with nothing in it is not drawn.
export function groupConversations(
  rows: readonly ConversationRow[],
  now: Date,
): ConversationGroup[] {
  const byGroup = new Map<ConversationGroupId, ConversationRow[]>();
  for (const row of rows) {
    const id = groupOf(daysAgo(new Date(row.lastActiveAt), now));
    byGroup.set(id, [...(byGroup.get(id) ?? []), row]);
  }
  return GROUPS.flatMap(({ id, label }) => {
    const members = byGroup.get(id);
    return members === undefined ? [] : [{ id, label, rows: members }];
  });
}
