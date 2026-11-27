import type { GatewayFailure } from '#/shared/lib/services/result';

// The problem types a message to a conversation is refused with, before any turn
// starts, when it cannot be given a grant under the sign-in held now: its earlier
// sign-in ended for a reason other than signing out, it is hidden, or this
// sign-in may not carry it on.
export const CONVERSATION_ENDED_TYPE = 'about:blank#conversation-ended';
export const CONVERSATION_ARCHIVED_TYPE = 'about:blank#conversation-archived';
export const CONVERSATION_ACCESS_REFUSED_TYPE = 'about:blank#conversation-access-refused';

// What a refused or failed call to the assistant carries to the panel: the
// gateway's own answer, so the panel words it and never the server's detail.
export class ChatCallError extends Error {
  readonly failure: GatewayFailure;
  // Which call failed: starting the conversation, a message, or a carrying on.
  readonly during: 'start' | 'messages' | 'resume';

  constructor(failure: GatewayFailure, during: 'start' | 'messages' | 'resume' = 'messages') {
    super('The assistant call failed.');
    this.name = 'ChatCallError';
    this.failure = failure;
    this.during = during;
  }
}
