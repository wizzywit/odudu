/**
 * The name of one run of a conversation's agent instance. An instance that
 * lapsed from idleness is never revived for the key it had, so the
 * conversation moves to the next generation and gets an instance of its own.
 */
export function runKey(conversationId: string, generation: number): string {
  return `${conversationId}.${String(generation)}`;
}

/**
 * Thrown by the minting port when the conversation's instance ran out from
 * idleness, which is the one refusal a new run answers. Every other refusal is
 * the call's own and leaves the conversation on the run it has.
 */
export class RunLapsed extends Error {
  constructor() {
    super('the conversation’s agent instance lapsed');
    this.name = 'RunLapsed';
  }
}
