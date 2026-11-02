export const TITLE = 'Audit trail';

export const NOUN = { one: 'audit event', other: 'audit events' } as const;

export const NO_COUNT =
  'The audit trail has no count: it is read a page at a time, newest first, and a total over a trail this long would be an estimate.';

export const NOTHING_YET =
  'Nothing has been recorded in this tenant yet. Changes, refusals, sign-ins and the like appear here as they happen.';

export const NOTHING_MATCHES = 'No event matches these filters.';

export const STALE_TITLE = 'This page of the trail has expired';

export const STALE_TEXT =
  'The page was read from a place in the trail that is no longer valid, because the filters changed or too long has passed. Start again from the newest event.';

export const NOT_FILTERS =
  'The request id, the address a request came from, and the caller’s tenant and client are not filters: the server does not search by them.';
