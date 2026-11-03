export function createEvents() {
  const listeners = new Set<() => void>();
  return { on: (listener: () => void) => listeners.add(listener) };
}
