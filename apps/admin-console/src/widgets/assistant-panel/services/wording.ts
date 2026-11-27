import { counted } from '#/shared/lib/services/format';

// Every word the conversation draws, under a stable id. A count or a name is
// a function beside this record, never a literal in a view.
export const PANEL_WORDING = {
  conversationLabel: 'Conversation',
  composerLabel: 'Message to the assistant',
  composerPlaceholder: 'Message the assistant',
  composerHint: 'Enter sends. Shift and Enter start a new line.',
  send: 'Send',
  stop: 'Stop',
  modeLabel: 'Mode',
  modeAsk: 'Ask',
  modeAct: 'Act',
  modeAskHint: 'Ask reads and explains. It changes nothing.',
  modeActHint: 'Act proposes changes. Each one waits for your approval.',
  modeFailed: 'The mode could not be changed. Try again.',
  modelsSummary: 'Models',
  modelsNote: 'The model each slot is set to run.',
  contextLabel: 'This page',
  emptyTitle: 'Ask about this tenant',
  emptyText:
    'The assistant can read what you can read here: clients, subjects, roles, settings and the audit trail.',
  emptyAskNote: 'In Ask mode it never changes anything.',
  emptyActNote: 'In Act mode every change it proposes waits for you to approve it.',
  loadingHistory: 'Loading the conversation',
  historyFailed: 'The conversation could not be loaded.',
  retry: 'Try again',
  you: 'You',
  assistant: 'Assistant',
  firstRunTitle: 'Before you start',
  firstRunDismiss: 'Got it',
  statusLabel: 'Assistant status',
  statusConnecting: 'Connecting',
  statusThinking: 'Thinking',
  statusWaiting: 'Waiting for you',
  statusStopped: 'Stopped',
  statusClosed: 'Stopped, connection closed',
  statusFinished: 'Finished',
  statusFailed: 'Failed',
  statusStepLimit: 'Stopped at the step limit',
  stoppedNote: 'Stopped. Nothing further was run.',
  stepLimitNote:
    'This answer used the most steps one answer may take, so the assistant stopped. Ask again, with a narrower question, to carry on.',
  waitingNote:
    'A change waits for your decision. The conversation takes no new message until you decide it.',
  modeBusy: 'Wait for the answer to finish before switching the mode.',
  valueEmpty: '(empty)',
  valueAbsent: '(not set)',
  cardLabel: 'Change waiting for your approval',
  cardTarget: 'Target',
  cardTenant: 'Tenant',
  cardWho: 'Decided by',
  cardWhoNote: 'This is your decision. The assistant cannot answer it.',
  cardBefore: 'Now',
  cardAfter: 'After',
  cardCreating: 'Does not exist yet',
  cardApprove: 'Approve',
  cardRefuse: 'Refuse',
  cardRefuseNote: 'Nothing is changed. The assistant is told you refused.',
  cardExpired: 'Expired',
  cardClosed: 'Closed',
  cardDecided: 'Decided',
  cardDecidingShort: 'Sending',
  cardExpiredAnnounce: 'The approval expired',
  cardMinuteLeft: 'One minute left to decide',
  cardDeciding: 'Sending your decision',
  cardApproved: 'Approved by you. The change was made.',
  cardApplying: 'Approved. Applying the change…',
  cardApprovedFailed: 'Approved, but the change failed. The step says why.',
  cardRefused: 'Refused by you. Nothing was changed.',
  cardExpiredOutcome: 'Expired. Nothing was changed.',
  cardNeeded: 'Approval needed',
  cardJump: 'Jump to approval',
  cardTime: 'Time left',
  cardChanges: 'Change',
  changeAdded: 'added',
  changeRemoved: 'removed',
  changeChanged: 'changed',
  changeSame: 'unchanged',
  stepApproved: 'Approved by you. The change was made.',
  stepApprovedFailed: 'Approved, but the change failed. The step says why.',
  stepNotApproved: 'Not approved. You refused it or it expired, and nothing was changed.',
  decideConflict:
    'This change was already decided or has expired, so nothing was changed. Ask the assistant to propose it again.',
  decideForbidden:
    'Only you, signed in to the console, can decide this change. Nothing was changed.',
  decideGone: 'This change is no longer there. Nothing was changed.',
  decideNetwork:
    'The console could not reach the server, so your decision was not sent. Try again.',
  decideDefect: 'Your decision could not be sent. Try again.',
  removeTitle: 'Approve this removal?',
  removeConsequence:
    'The assistant would remove what this card names. Approving it makes the change straight away.',
  removeConfirm: 'Approve removal',
  tierBNote: 'This removes something. You are asked once more before it is approved.',
  tierCNote:
    'This changes who can sign in, what a token carries or what goes live. You are asked to type the name it names before it is approved.',
  typedTitle: 'Approve this change?',
  typedConsequence:
    'The assistant would make the change this card shows. Type the name it names to approve it. The change is made straight away.',
  typedConfirm: 'Approve change',
  setAdds: 'Adds',
  setRemoves: 'Removes',
  setNone: 'Nothing',
  feedLabel: 'Steps',
  feedShow: 'Show steps',
  feedHide: 'Hide steps',
  stepRaw: 'Show the call',
  stepRawHide: 'Hide the call',
  stepRawLabel: 'The call as sent',
  stepRawError: 'It failed with',
  stepRawCut: '(the rest of the call is not shown)',
  closedNote: 'The connection closed before the answer finished.',
  failedTitle: 'The assistant could not finish',
  traceLabel: 'Reference',
  meterLabel: 'Allowance',
  meterRefused: 'Allowance used',
  warningNote: 'At the limit the assistant stops. It does not switch to another model.',
  budgetStopTitle: 'Stopped: allowance used',
  closeButton: 'Close',
  newConversation: 'New conversation',
  stepRunning: 'Running',
  stepDone: 'Done',
  stepFailed: 'Failed',
  stepDenied: 'Refused',
  stepWaiting: 'Waiting for you',
  stepsLabel: 'Steps',
  tableLabel: 'Table',
  untitled: 'Assistant',
  conversationsButton: 'Conversations',
  conversationsTitle: 'Your conversations',
  conversationsBack: 'Back',
  conversationsNew: 'New conversation',
  conversationsNewShort: 'New',
  conversationsLoading: 'Loading your conversations',
  conversationsFailed: 'Your conversations could not be loaded.',
  conversationsEmptyTitle: 'No conversations yet',
  conversationsEmptyText: 'Go back and send a message to start one.',
  conversationsRetention:
    'A conversation is removed after it has been idle for the number of days your administrators have set.',
  conversationsLabel: 'Conversations',
  conversationsNoun: 'conversations',
  groupToday: 'Today',
  groupYesterday: 'Yesterday',
  groupWeek: 'Earlier this week',
  groupEarlier: 'Earlier',
  archivedTitle: 'Archived',
  archivedFailed: 'Archived conversations could not be loaded.',
  archivedTag: 'Archived',
  reportedTag: 'Reported',
  untitledConversation: 'Untitled conversation',
  menuTrigger: 'Actions',
  actionOpen: 'Open',
  actionArchive: 'Archive',
  actionRestore: 'Restore',
  actionExportMarkdown: 'Export as Markdown',
  actionExportJson: 'Export as JSON',
  actionDelete: 'Delete',
  deleteHeld: 'Reported conversations are kept for review.',
  undoArchived: 'Archived.',
  undo: 'Undo',
  switchRunning: 'An answer is still running. Stop it to switch, or keep waiting.',
  switchStop: 'Stop and switch',
  switchWait: 'Keep waiting',
  deleteTitle: 'Delete this conversation?',
  deleteConfirm: 'Delete conversation',
  deleteConsequence:
    'Its messages are removed and cannot be brought back. A record that a conversation was deleted is kept, without its text.',
  endedNote:
    'This conversation\u2019s sign-in was ended for a reason other than you signing out, so it takes no new message. You can read it.',
  endedAction: 'Start a new conversation',
  notCarriedOnNote:
    'This conversation could not be carried on with the sign-in you hold now. The assistant may be switched off, or you may no longer have the access it needs. Nothing was sent.',
  archivedNote: 'This conversation is archived. Restore it to continue.',
  archivedAction: 'Restore',
  unavailableNote:
    'The assistant was switched off for this tenant while the conversation was running. Nothing further was run. Ask an administrator to switch it on again.',
} as const;

// A count or a name written into a sentence.
export function expiresInMinutes(minutes: number): string {
  return `Expires in ${String(minutes)} min`;
}

export function expiresInSeconds(seconds: number): string {
  return `Expires in ${String(seconds)} s`;
}

// What the card says of the tenant a change is made in, where that is not the
// person's own: the change is theirs to approve, and lands there.
export function changeInKicker(tenant: string): string {
  return `Change in ${tenant} waiting for your approval`;
}

export function changeTenantNote(tenant: string): string {
  return `${tenant} is not your own tenant. Approving makes the change there.`;
}

export function removalIn(tenant: string): { title: string; consequence: string } {
  return {
    title: `Approve this removal in ${tenant}?`,
    consequence: `The assistant would remove what this card names in ${tenant}, not in your own tenant. Approving it makes the change straight away.`,
  };
}

export function typedChangeIn(tenant: string): { title: string; consequence: string } {
  return {
    title: `Approve this change in ${tenant}?`,
    consequence: `The assistant would make the change this card shows in ${tenant}, not in your own tenant. Type the name it names to approve it. The change is made straight away.`,
  };
}

export function setHeading(label: string, count: number): string {
  return `${label}: ${counted(count, 'name', 'names')}`;
}

export function actInNote(tenant: string): string {
  return `Act makes changes in ${tenant}, not in your own tenant.`;
}

export function targetDeclinesAct(tenant: string): string {
  return `${tenant} does not offer Act, so this conversation stays in Ask.`;
}

export function youAs(username: string): string {
  return `You, as ${username}`;
}

export function copyIdLabel(kind: string): string {
  return `Copy the ${kind} id`;
}

export type PanelWordingId = keyof typeof PANEL_WORDING;
