/** A JSON path the way every `errors[].path` spells one: `document.clients[0].redirect_uris`. */
export function fieldPath(segments: readonly PropertyKey[]): string {
  return segments.reduce<string>((path, segment) => {
    if (typeof segment === 'number') return `${path}[${String(segment)}]`;
    return path === '' ? String(segment) : `${path}.${String(segment)}`;
  }, '');
}
