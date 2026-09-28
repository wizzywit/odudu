export function load(): string | null {
  return localStorage.getItem('clients');
}
