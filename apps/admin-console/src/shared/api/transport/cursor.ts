// Any origin will do: the gateway's targets are paths, and only the query is read.
const RESOLVE_AGAINST = 'http://gateway.invalid';

// RFC 8288: a Link header is comma-separated `<target>; param=value` entries,
// and `rel` may name several relation types. The gateway has already
// rewritten each target to `/console/api/admin/…`, so the cursor is read
// from it as it stands.
export function nextCursor(link: string | null): string | null {
  if (link === null) return null;
  for (const value of link.split(/,(?=\s*<)/)) {
    const match = /^\s*<([^>]*)>(.*)$/.exec(value);
    if (match === null) continue;
    const [, target = '', params = ''] = match;
    const rel = /;\s*rel\s*=\s*(?:"([^"]*)"|([^\s;]+))/i.exec(params);
    const types = (rel?.[1] ?? rel?.[2] ?? '').toLowerCase().split(/\s+/);
    if (!types.includes('next')) continue;
    return new URL(target, RESOLVE_AGAINST).searchParams.get('cursor');
  }
  return null;
}
