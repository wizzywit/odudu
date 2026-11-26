// The turns running in this process, each with the means to end it. A turn
// that ends removes itself, so the map holds one entry per turn in flight and
// is bounded by `limit`: past it a new turn is refused rather than admitted.
export interface TurnRegistry {
  /** Admits a turn, or says why not. The returned function removes it. */
  begin(
    conversationId: string,
    abort: () => void,
  ): { kind: 'started'; end: () => void } | { kind: 'busy' } | { kind: 'saturated' };
  /** Ends the conversation's running turn; false when none runs here. */
  stop(conversationId: string): boolean;
}

export function createTurnRegistry(limit: number): TurnRegistry {
  const running = new Map<string, () => void>();
  return {
    begin(conversationId, abort) {
      if (running.has(conversationId)) return { kind: 'busy' };
      if (running.size >= limit) return { kind: 'saturated' };
      running.set(conversationId, abort);
      return {
        kind: 'started',
        end: () => {
          if (running.get(conversationId) === abort) running.delete(conversationId);
        },
      };
    },
    stop(conversationId) {
      const abort = running.get(conversationId);
      if (abort === undefined) return false;
      abort();
      return true;
    },
  };
}
