import { ChatCallError } from '#/widgets/assistant-panel/services/chatCallError';
import type { Failure } from '#/widgets/assistant-panel/types/chat';

// The line the server's stream carries for a turn that failed for a reason
// that is not the person's to act on.
export const GENERIC_FAILURE = 'The assistant could not finish this answer. Please try again.';

const RUNNING = 'Another answer is still running in this conversation. Wait for it, or stop it.';
const WAITING = 'A change in this conversation is waiting for your decision.';

const UNREACHED = 'The console could not reach the assistant. Try again.';

// A stream's error text is a sentence the server wrote; anything longer than
// this is not one, and is not shown.
const SENTENCE_MAX = 600;

const BY_STATUS: Readonly<Record<number, string>> = {
  403: 'You do not have permission to use the assistant here.',
  404: 'This conversation is no longer available. Start a new one.',
  429: 'The assistant is busy right now. Try again in a moment.',
};

// A conversation that cannot be started is refused as a path never served,
// which is also how a tenant that switched the assistant off answers.
const NOT_OFFERED =
  'The assistant is not available here. It may be switched off for this tenant, or not offered to this sign-in.';

// A 409 is two things: a turn already running, or a change that waits for the
// person's decision, which the server tells apart in its detail.
function causeOf(
  status: number,
  detail: string | undefined,
  during: 'start' | 'turn',
): string | undefined {
  if (status === 409) return detail?.includes('decision') === true ? WAITING : RUNNING;
  return during === 'start' && status === 404 ? NOT_OFFERED : BY_STATUS[status];
}

function ofCall(error: ChatCallError): Failure {
  const { failure } = error;
  if (failure.kind !== 'problem') return { cause: UNREACHED, trace: null };
  const { status, instance, detail } = failure.problem;
  const cause = causeOf(status, detail, error.during);
  return { cause: cause ?? UNREACHED, trace: instance ?? null };
}

// What a failed turn is shown as: a plain cause and, when the request has one,
// its reference. Never an error's stack or the text of a defect.
export function failureOf(error: unknown): Failure {
  if (error instanceof ChatCallError) return ofCall(error);
  if (error instanceof TypeError) return { cause: UNREACHED, trace: null };
  if (error instanceof Error && !(error instanceof SyntaxError)) {
    const text = error.message.trim();
    if (text !== '' && text.length <= SENTENCE_MAX) return { cause: text, trace: null };
  }
  return { cause: GENERIC_FAILURE, trace: null };
}
