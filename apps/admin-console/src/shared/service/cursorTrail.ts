// The cursors of the pages visited so far, oldest first, kept in the URL so
// that Previous is a step back through them rather than a request the API
// cannot answer: a cursor only ever points forward.
export type CursorTrail = readonly string[];

export function currentCursor(trail: CursorTrail): string | undefined {
  return trail.at(-1);
}

export function advance(trail: CursorTrail, next: string): CursorTrail {
  return [...trail, next];
}

export function retreat(trail: CursorTrail): CursorTrail {
  return trail.slice(0, -1);
}

const PARAM = 'after';
const MAX_PAGES = 100;
const MAX_CURSOR = 2048;
// The admin API's cursor: a base64url payload and a base64url tag.
const CURSOR = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;

// A trail with one bad entry cannot be walked back correctly, so it is
// dropped whole and the list starts again from its first page.
export function trailFromSearch(search: URLSearchParams | string): CursorTrail {
  const trail = new URLSearchParams(search).getAll(PARAM);
  const valid =
    trail.length <= MAX_PAGES &&
    trail.every((cursor) => cursor.length <= MAX_CURSOR && CURSOR.test(cursor));
  return valid ? trail : [];
}

export function trailToSearch(
  trail: CursorTrail,
  base: URLSearchParams = new URLSearchParams(),
): URLSearchParams {
  const search = new URLSearchParams(base);
  search.delete(PARAM);
  for (const cursor of trail) search.append(PARAM, cursor);
  return search;
}
