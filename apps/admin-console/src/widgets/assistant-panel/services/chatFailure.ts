import {
  CONVERSATION_ENDED_TYPE,
  ChatCallError,
} from '#/widgets/assistant-panel/services/chatCallError';
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

// What the server says when a carrying on is refused: a change still waits,
// or none does (packages/protocol-admin, the resume handler). A 409 on a
// message is only ever a turn already running, so the route called decides.
const STILL_WAITS = 'a change still waits for your decision';
const NOTHING_WAITING = 'There is no change waiting to be carried on.';

const ENDED =
  'This conversation ended when your sign-in did, so it takes no new message. You can still read it. Start a new conversation to carry on.';

function conflictOf(
  during: ChatCallError['during'],
  type: string,
  detail: string | undefined,
): string {
  if (type === CONVERSATION_ENDED_TYPE) return ENDED;
  if (during !== 'resume') return RUNNING;
  return detail === STILL_WAITS ? WAITING : NOTHING_WAITING;
}

// In another tenant a refusal has two more causes the person can act on: the
// tenant (or their own) switched the assistant off, or they no longer hold
// what the server asks of a system administrator there.
function otherTenantCause(
  status: number,
  during: ChatCallError['during'],
  tenant: string,
): string | undefined {
  if (status === 403) {
    return `You need use-assistant and manage-tenants to use the assistant in ${tenant}. Ask an administrator of your own tenant.`;
  }
  return during === 'start' && status === 404
    ? `The assistant is not available in ${tenant}. ${tenant} may have switched it off, or your own tenant has.`
    : undefined;
}

function causeOf(
  status: number,
  problem: { type: string; detail?: string | undefined },
  during: ChatCallError['during'],
  actingIn: string | null,
): string | undefined {
  if (status === 409) return conflictOf(during, problem.type, problem.detail);
  const other = actingIn === null ? undefined : otherTenantCause(status, during, actingIn);
  if (other !== undefined) return other;
  return during === 'start' && status === 404 ? NOT_OFFERED : BY_STATUS[status];
}

function ofCall(error: ChatCallError, actingIn: string | null): Failure {
  const { failure } = error;
  if (failure.kind !== 'problem') return { cause: UNREACHED, trace: null };
  const { status, instance } = failure.problem;
  const cause = causeOf(status, failure.problem, error.during, actingIn);
  return { cause: cause ?? UNREACHED, trace: instance ?? null };
}

// What a failed turn is shown as: a plain cause and, when the request has one,
// its reference. Never an error's stack or the text of a defect.
export function failureOf(error: unknown, actingIn: string | null = null): Failure {
  if (error instanceof ChatCallError) return ofCall(error, actingIn);
  if (error instanceof TypeError) return { cause: UNREACHED, trace: null };
  if (error instanceof Error && !(error instanceof SyntaxError)) {
    const text = error.message.trim();
    if (text !== '' && text.length <= SENTENCE_MAX) return { cause: text, trace: null };
  }
  return { cause: GENERIC_FAILURE, trace: null };
}
