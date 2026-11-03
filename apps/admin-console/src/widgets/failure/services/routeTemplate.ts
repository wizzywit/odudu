// The route as declared, with its parameters unfilled: the last route matched.
export function routeTemplate(matches: readonly { routeId: string }[]): string {
  const last = matches.at(-1)?.routeId;
  if (last === undefined) return '(none)';
  return last === '__root__' ? '/' : last;
}
