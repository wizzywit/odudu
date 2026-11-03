export function createEvents() {
  const listeners = new Set<() => void>();
  return {
    on: (listener: () => void) => listeners.add(listener),
    emit: () => {
      for (const listener of listeners) listener();
    },
  };
}

export default function createDefaultEvents() {
  const listeners = new Set<() => void>();
  return { on: (listener: () => void) => listeners.add(listener) };
}
