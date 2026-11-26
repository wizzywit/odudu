import type { GatewayFailure } from '#/shared/lib/services/result';

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
