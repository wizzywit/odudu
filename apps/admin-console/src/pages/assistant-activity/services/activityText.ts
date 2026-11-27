import {
  ASSISTANT_REPORTED_MAX,
  REPLAY_TURNS_MAX,
  REPORTED_OLD_DAYS,
} from '@odudu/contracts/admin';
import { groupedNumber } from '#/shared/lib/services/format';

export const NOUN = { one: 'conversation', other: 'conversations' } as const;

export const PAGE_RULE =
  'Every conversation people in this tenant had with the assistant, latest first: who, which tools it called, the tokens it used and how each answer ended. Open one to replay it step by step.';

export const NOTHING_YET = 'Nobody in this tenant has asked the assistant anything yet.';

export const COLUMNS = {
  conversation: 'Conversation',
  person: 'Person',
  lastActive: 'Last active',
  activity: 'Activity',
  outcome: 'Last outcome',
  kept: 'Changes and kept',
} as const;

export const FILTERS = {
  person: 'Person (id)',
  conversation: 'Conversation (id)',
  tool: 'Tool',
  outcome: 'Last outcome',
  kind: 'Kind of conversation',
} as const;

export const FILTER_HINTS = {
  person: 'The id of a subject of this tenant.',
  conversation: 'The id of a conversation.',
  tool: 'A tool name such as list_clients.',
} as const;

export const NO_TITLE = 'Untitled conversation';
export const NO_USERNAME = 'a person no longer in this tenant';
export const NOT_ANSWERED = 'No answer yet';
export const ONLY_THIS_PERSON = 'Only this person';

export const WITHHELD_NOTE =
  'This tenant does not let people who hold read-assistant-activity read what was said, so titles, questions, answers and what the tools were given and returned are not shown. Who used the assistant, when, which tools it called, the tokens and how each answer ended are.';

export const REPORT_LABEL = 'Report this answer';
export const REPORTED_LABEL = 'Reported';
export const REPORT_FULL = `This tenant already keeps ${groupedNumber(ASSISTANT_REPORTED_MAX)} reported conversations, the most it may, so this one was not reported.`;
export const REPORT_EXPLAINED =
  'Keeps the conversation past the retention period so it can be looked into.';

export const EXPORT_LABEL = 'Export as test case';
export const EXPORT_EXPLAINED =
  'Downloads this conversation as a promptfoo test case: what was asked, the tools that were called and what the answers should contain.';

export const REPLAY_TITLE = 'Conversation replay';
export const BACK_LABEL = 'Assistant activity';
export const REPLAY_FAILED = 'The conversation could not be loaded';
export const REPLAY_LOADING = 'Loading the conversation';
export const REPLAY_GONE = 'No conversation of this tenant has this id.';

export const WHY_MODEL = 'Why this model';
export const WHY_STOPPED = 'Why it stopped';
export const ASKED = 'What was asked';
export const CHANGES = 'Changes the assistant proposed';
export const NO_CHANGES = 'It proposed no change.';
export const STEPS = 'Steps';
export const DECISIONS = 'Decisions';

export const NOT_ENDED = 'Not ended';
export const SHOW_TURN = 'Show the steps';
export const HIDE_TURN = 'Hide the steps';

export const TURNS_OMITTED = (count: number): string =>
  `${groupedNumber(count)} earlier ${count === 1 ? 'answer is' : 'answers are'} not shown. The replay holds the latest ${groupedNumber(REPLAY_TURNS_MAX)}.`;

export const MORE_EVENTS = (count: number): string => `Show ${groupedNumber(count)} more`;
export const EVENTS_NOT_SHOWN = (count: number): string =>
  `${groupedNumber(count)} more ${count === 1 ? 'entry is' : 'entries are'} not shown.`;

export const KEPT = {
  no: 'Not reported',
  reported: 'Reported',
  old: `Reported over ${String(REPORTED_OLD_DAYS)} days ago`,
} as const;

export const FACTS = {
  person: 'Person',
  profile: 'Profile',
  started: 'Started',
  lastActive: 'Last active',
} as const;

export const APPROVAL_COLUMNS = {
  change: 'Change',
  target: 'Aimed at',
  decision: 'Decision',
  decided: 'Decided',
} as const;

export const COPY_ID = 'conversation id';
export const ANSWERS = 'Answers';
export const NOTHING = '—';
export const SHOWN_IN_PART = 'Shown in part.';

export const openSubject = (name: string): string => `${name}, open the subject`;
