interface Client {
  fetch(path: string): Promise<unknown>;
  readonly socket: WebSocket | null;
}

// Mentions fetch( in a comment and a string, calls a method named fetch,
// names a key fetch, and names fetch's type: none of them sends a request.
export const described = 'fetch(';

export type Fetcher = typeof fetch;

export function load(client: Client): Promise<unknown> {
  return client.fetch('/clients');
}

export const handlers = { fetch: load, sendBeacon: load };
