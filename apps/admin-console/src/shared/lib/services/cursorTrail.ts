// The cursors of the pages visited so far, oldest first, kept in the URL so
// that Previous is a step back through them rather than a request the API
// cannot answer: a cursor only ever points forward.
export type CursorTrail = readonly string[];

export function currentCursor(trail: CursorTrail): string | undefined {
  return trail.at(-1);
}

// The URL the trail is written into has to reach the server whole: nginx's
// default request line is 8 KiB (large_client_header_buffers). A real audit
// cursor is 320 characters and a sorted subjects cursor 364, so the budget
// stops a trail at 16 to 18 pages of those, about 6.5 KB; the page count
// only bounds a trail of short cursors. The pager names neither number.
export const MAX_PAGES = 20;
const TRAIL_BUDGET = 6_000;

function weight(trail: CursorTrail): number {
  return trail.reduce((sum, cursor) => sum + cursor.length, 0);
}

export function canAdvance(trail: CursorTrail, next: string): boolean {
  return trail.length < MAX_PAGES && weight(trail) + next.length <= TRAIL_BUDGET;
}

// At the limit the trail stays as it is; the pager says why Next is off.
export function advance(trail: CursorTrail, next: string): CursorTrail {
  return canAdvance(trail, next) ? [...trail, next] : trail;
}

export function retreat(trail: CursorTrail): CursorTrail {
  return trail.slice(0, -1);
}

const PARAM = 'after';
const MAX_CURSOR = 2048;
// The admin API's cursor: a base64url payload and a base64url tag.
const CURSOR = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;

// A trail with one bad entry cannot be walked back correctly, so it is
// dropped whole and the list starts again from its first page.
export function trailFromSearch(search: URLSearchParams | string): CursorTrail {
  const trail = new URLSearchParams(search).getAll(PARAM);
  const valid =
    trail.length <= MAX_PAGES &&
    weight(trail) <= TRAIL_BUDGET &&
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
