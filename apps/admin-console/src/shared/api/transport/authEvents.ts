interface AuthEventMap {
  authEnded: [];
  // Another sign-in in this browser replaced the session this tab shows.
  principalChanged: [];
}
type AuthEventName = keyof AuthEventMap;
type Listener<N extends AuthEventName> = (...args: AuthEventMap[N]) => void;

export interface AuthEvents {
  on<N extends AuthEventName>(name: N, listener: Listener<N>): () => void;
  emit<N extends AuthEventName>(name: N, ...args: AuthEventMap[N]): void;
}

// Every listener runs even when an earlier one throws; the first error is
// rethrown afterwards, so one broken subscriber neither hides the event from
// the rest nor goes unseen.
export function createAuthEvents(): AuthEvents {
  const listeners: { [N in AuthEventName]: Set<Listener<N>> } = {
    authEnded: new Set(),
    principalChanged: new Set(),
  };
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
