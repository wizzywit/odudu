import type { ActivityPosition } from '#/service/activity-rows';

// The time as PostgreSQL prints a timestamptz: date, time with up to six
// fractional digits and an offset. A cursor is signed by the route that issues
// it, and this check holds a malformed one off the database all the same.
const TIME = /^\d{4,6}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:\d{2})?)?$/u;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export function encodePosition(position: ActivityPosition): string {
  return `${position.lastActiveAt}|${position.id}`;
}

export function decodePosition(raw: string): ActivityPosition | undefined {
  const parts = raw.split('|');
  const [lastActiveAt, id] = parts;
  if (parts.length !== 2 || lastActiveAt === undefined || id === undefined) return undefined;
  return TIME.test(lastActiveAt) && ID.test(id) ? { lastActiveAt, id } : undefined;
}
