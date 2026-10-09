export function request(path: string): Promise<Response> {
  return fetch(path, { credentials: 'same-origin' });
}
