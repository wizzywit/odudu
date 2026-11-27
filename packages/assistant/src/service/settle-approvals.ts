import type { UIMessage } from 'ai';
import type { ApprovalCardRow } from '#/service/approval-types';

type Part = UIMessage['parts'][number];

export interface Settled {
  readonly parts: Part[];
  // Changes whose approval is still live: the person has not decided.
  readonly waiting: number;
  // Changes the SDK is to run now, because the person approved them.
  readonly resumable: number;
  // Changes closed or handed back by this call.
  readonly settled: number;
}

// What the model reads where a change did not run. Each says why, in words it
// can pass on to the person.
export const DECLINED = 'The person declined this change. Nothing was changed.';
export const EXPIRED =
  'The approval for this change ended before it was decided. Nothing was changed.';
export const NOT_RUN = 'The person moved on before this change was run. Nothing was changed.';
export const UNKNOWN_OUTCOME =
  'The outcome of this change is not known: it was approved and spent, but no result was kept. ' +
  'Read the target to see whether it was made.';

interface ToolPart {
  readonly type: string;
  readonly toolCallId: string;
  readonly state: string;
  readonly approval?: { readonly id: string };
}

// A change the person approved that the SDK has not yet run.
function handedBack(part: Part): part is Part & ToolPart {
  const candidate = part as Partial<ToolPart> & { approval?: { approved?: unknown } };
  return (
    typeof candidate.type === 'string' &&
    candidate.type.startsWith('tool-') &&
    candidate.state === 'approval-responded' &&
    candidate.approval?.approved === true
  );
}

function approvalRequested(part: Part): part is Part & ToolPart {
  const candidate = part as Partial<ToolPart>;
  return (
    typeof candidate.type === 'string' &&
    candidate.type.startsWith('tool-') &&
    candidate.state === 'approval-requested' &&
    typeof candidate.toolCallId === 'string' &&
    typeof candidate.approval?.id === 'string'
  );
}

function denied(part: Part & ToolPart, reason: string): Part {
  return {
    ...part,
    state: 'output-denied',
    approval: { id: part.approval?.id ?? '', approved: false, reason },
  } as unknown as Part;
}

/**
 * Brings the pending change parts of one assistant message up to date with
 * what the person decided. `resume` hands an approved change to the SDK, which
 * runs it; `message` is for a person who sent another message instead, so an
 * approved change that was never run is closed as not run and nothing is
 * handed on. A change whose approval ended undecided is closed as expired; one
 * still live is left and counted as waiting.
 */
export function settleParts(
  parts: readonly Part[],
  cards: readonly ApprovalCardRow[],
  now: Date,
  how: 'resume' | 'message',
): Settled {
  let waiting = 0;
  let resumable = 0;
  let settled = 0;
  const next = parts.map((part): Part => {
    if (handedBack(part)) {
      // Settled by an earlier call that did not get to run it, or that ran it
      // and did not keep the result: the card says which.
      const spent = cards.find((entry) => entry.toolCallId === part.toolCallId)?.state;
      if (spent === 'consumed') {
        settled += 1;
        return { ...part, state: 'output-error', errorText: UNKNOWN_OUTCOME } as unknown as Part;
      }
      if (how === 'message') {
        settled += 1;
        return denied(part, NOT_RUN);
      }
      resumable += 1;
      return part;
    }
    if (!approvalRequested(part)) return part;
    const card = cards.find((entry) => entry.toolCallId === part.toolCallId);
    if (card === undefined) return part;
    if (card.state === 'pending' && card.expiresAt > now) {
      waiting += 1;
      return part;
    }
    settled += 1;
    if (card.state === 'approved') {
      if (how === 'message') return denied(part, NOT_RUN);
      resumable += 1;
      return {
        ...part,
        state: 'approval-responded',
        approval: { ...part.approval, id: part.approval?.id ?? '', approved: true },
      } as unknown as Part;
    }
    if (card.state === 'denied') return denied(part, DECLINED);
    if (card.state === 'consumed') {
      return { ...part, state: 'output-error', errorText: UNKNOWN_OUTCOME } as unknown as Part;
    }
    return denied(part, EXPIRED);
  });
  return { parts: next, waiting, resumable, settled };
}
