export function load(): string | null {
  return localStorage.getItem('theme');
}
