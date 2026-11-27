import { ASSISTANT_REPORTED_MAX } from '@odudu/contracts/admin';
import { COULD_NOT_FINISH } from '#/shared/lib/services/failure';
import { groupedNumber } from '#/shared/lib/services/format';
import type { GatewayResult } from '#/shared/lib/services/result';
import {
  REPORTED_LABEL,
  REPORT_FULL,
  REPORT_LABEL,
} from '#/pages/assistant-activity/services/activityText';
import type { Reported } from '#/pages/assistant-activity/types/activity';

// Where reporting a conversation stands. After `full` it stays held: another
// attempt would be refused the same way, so the control says why instead.
export type ReportState =
  | { kind: 'idle' }
  | { kind: 'reported'; note: string | null }
  | { kind: 'full'; text: string }
  | { kind: 'failed'; text: string };

export const IDLE: ReportState = { kind: 'idle' };

function nearLimitNote(reported: Reported): string | null {
  return reported.nearLimit
    ? `This tenant now keeps ${groupedNumber(reported.reportedCount)} of ${groupedNumber(ASSISTANT_REPORTED_MAX)} reported conversations.`
    : null;
}

export function reportStateOf(result: GatewayResult<Reported>): ReportState {
  if (result.ok) return { kind: 'reported', note: nearLimitNote(result.data) };
  if (result.kind === 'network') {
    return {
      kind: 'failed',
      text: 'Could not confirm whether it was reported. Nothing was sent again; reload to see.',
    };
  }
  if (result.kind !== 'problem') return { kind: 'failed', text: COULD_NOT_FINISH };
  const { status, detail, title } = result.problem;
  if (status === 409) return { kind: 'full', text: REPORT_FULL };
  if (status === 404) return { kind: 'failed', text: 'This conversation is no longer there.' };
  return { kind: 'failed', text: `Not reported: ${detail ?? title}` };
}

// Whether the control is held: the conversation is kept already, or the tenant
// cannot keep another.
export function reportHeld(state: ReportState, reportedAt: string | null): boolean {
  return reportedAt !== null || state.kind === 'reported' || state.kind === 'full';
}

// The line beside the control, if there is one.
export function reportLine(state: ReportState): string | null {
  switch (state.kind) {
    case 'reported':
      return state.note;
    case 'full':
    case 'failed':
      return state.text;
    case 'idle':
      return null;
  }
}

export function reportLabel(state: ReportState, reportedAt: string | null): string {
  return reportedAt !== null || state.kind === 'reported' ? REPORTED_LABEL : REPORT_LABEL;
}
