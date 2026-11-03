export function within(path: string, above: string): boolean {
  return path === above || path.startsWith(`${above}/`);
}
