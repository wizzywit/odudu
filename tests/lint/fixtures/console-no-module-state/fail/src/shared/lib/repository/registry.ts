const sources = new Set<string>();
const queue: string[] = [];
const state = { count: 0, names: {} as Record<string, number> };
const seen = new Map<string, number>();
const options = { retries: 3 };

export function register(source: string): void {
  sources.add(source);
  queue.push(source);
  state.count += 1;
  state.names[source] = 1;
  seen.set(source, 1);
  Object.assign(options, { retries: 4 });
}

export function forget(source: string): void {
  delete state.names[source];
}
