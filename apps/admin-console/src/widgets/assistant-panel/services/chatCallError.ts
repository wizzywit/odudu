import type { GatewayFailure } from '#/shared/lib/services/result';

// What a refused or failed call to the assistant carries to the panel: the
// gateway's own answer, so the panel words it and never the server's detail.
export class ChatCallError extends Error {
  readonly failure: GatewayFailure;
  // Whether the conversation could not be started, or a turn of it failed.
  readonly during: 'start' | 'turn';

  constructor(failure: GatewayFailure, during: 'start' | 'turn' = 'turn') {
    super('The assistant call failed.');
    this.name = 'ChatCallError';
    this.failure = failure;
    this.during = during;
  }
}
