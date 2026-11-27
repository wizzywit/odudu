import type { AssistantMode } from '#/widgets/assistant-panel/types/chat';

export type ConversationGroupId = 'today' | 'yesterday' | 'week' | 'earlier';

// One conversation as the list draws it, worded for the view.
export interface ConversationRow {
  id: string;
  title: string;
  lastActiveAt: string;
  mode: AssistantMode;
  modeLabel: string;
  // The tenant the conversation is about, when it is not the person's own.
  tenant: string | null;
  archived: boolean;
  reported: boolean;
  // Names the row's menu, so a list of menus says which conversation each is for.
  menuLabel: string;
}

export interface ConversationGroup {
  id: ConversationGroupId;
  label: string;
  rows: ConversationRow[];
}

export type ConversationListStatus = 'loading' | 'failed' | 'ready';

// One of the two lists, open and archived, as the view draws it.
export interface ConversationSection {
  status: ConversationListStatus;
  rows: ConversationRow[];
  more: boolean;
  loadingMore: boolean;
  moreFailed: boolean;
  limited: boolean;
  loadMore: () => void;
  retry: () => void;
}

// Everything the Conversations view draws and can be asked to do.
export interface ConversationsState {
  open: boolean;
  show: () => void;
  hide: () => void;
  // The id of the conversation the panel is showing, which its row marks.
  currentId: string | null;
  // The open conversations, grouped by day, and the archived ones.
  groups: ConversationGroup[];
  opened: ConversationSection;
  archived: ConversationSection;
  archivedLabel: string;
  // One clock for every row's time.
  now: Date;
  // Where a pick is waiting on the person to say whether to stop the answer.
  pending: SwitchTarget | null;
  onOpen: (row: ConversationRow) => void;
  onNew: () => void;
  onStopAndSwitch: () => void;
  onKeepWaiting: () => void;
  onArchive: (row: ConversationRow) => void;
  onRestore: (row: ConversationRow) => void;
  onRestoreCurrent: () => void;
  onExport: (row: ConversationRow, format: ExportFormat) => void;
  // The conversation just hidden, offered back for a moment.
  undo: ConversationRow | null;
  // The row just hidden, which fades while the list is read again.
  leaving: string | null;
  onUndo: () => void;
  deleting: ConversationRow | null;
  deleteBusy: boolean;
  deleteProblem: string | null;
  onAskDelete: (row: ConversationRow) => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}

// Why a conversation takes no message: the person hid it, or the sign-in it
// ran under has ended.
export type ReadOnlyReason = 'archived' | 'ended';

// Where a pick in the list leads: a conversation, or a new one (`id` null).
export interface SwitchTarget {
  id: string | null;
  archived: boolean;
}

export type ExportFormat = 'markdown' | 'json';
