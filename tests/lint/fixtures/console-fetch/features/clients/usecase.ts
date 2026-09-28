interface Client {
  fetch(path: string): Promise<unknown>;
}

// Mentions fetch( in a comment and a string, and calls a method named fetch.
export const described = 'fetch(';

export function load(client: Client): Promise<unknown> {
  return client.fetch('/clients');
}
