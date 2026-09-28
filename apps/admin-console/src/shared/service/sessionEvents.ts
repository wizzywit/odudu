interface SessionEventMap {
  readonly sessionEnded: [];
}
type SessionEventName = keyof SessionEventMap;
type Listener<N extends SessionEventName> = (...args: SessionEventMap[N]) => void;

export interface SessionEvents {
  on<N extends SessionEventName>(name: N, listener: Listener<N>): () => void;
  emit<N extends SessionEventName>(name: N, ...args: SessionEventMap[N]): void;
}

// Every listener runs even when an earlier one throws; the first error is
// rethrown afterwards, so one broken subscriber neither hides the event from
// the rest nor goes unseen.
export function createSessionEvents(): SessionEvents {
  const listeners: { [N in SessionEventName]: Set<Listener<N>> } = { sessionEnded: new Set() };
  return {
    on(name, listener) {
      listeners[name].add(listener);
      return () => {
        listeners[name].delete(listener);
      };
    },
    emit(name, ...args) {
      const errors: unknown[] = [];
      for (const listener of [...listeners[name]]) {
        try {
          listener(...args);
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length > 0) throw errors[0];
    },
  };
}

export const sessionEvents = createSessionEvents();
