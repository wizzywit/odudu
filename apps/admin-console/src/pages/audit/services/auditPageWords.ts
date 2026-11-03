import { EXPORT_NOTE } from '#/pages/audit/services/auditExport';
import { TOO_BROAD_TITLE } from '#/pages/audit/services/tooBroad';

// What the audit page says of itself; the area's name is the area's own.
export const AUDIT_PAGE_WORDS = {
  trailLabel: 'Audit events',
  header: {
    description:
      'Every change made in this tenant, and every one refused, with who made it and from where.',
    exportLabel: 'Export these events',
    exportingLabel: 'Exporting…',
  },
  notes: {
    noCount:
      'The audit trail has no count: it is read a page at a time, newest first, and a total over a trail this long would be an estimate.',
    export: EXPORT_NOTE,
    lastExport: 'Last export',
  },
  load: {
    loading: 'Loading audit events',
    failed: 'The audit trail could not be loaded',
    moreFailedNoun: 'audit events',
  },
  empty: {
    yetTitle: 'No audit events yet',
    yetText:
      'Nothing has been recorded in this tenant yet. Changes, refusals, sign-ins and the like appear here as they happen.',
    matchesTitle: 'No event matches these filters',
    matchesText: 'No event matches these filters.',
    showEvery: 'Show every event',
  },
  stale: {
    title: 'This page of the trail has expired',
    text: 'The page was read from a place in the trail that is no longer valid, because the filters changed or too long has passed. Start again from the newest event.',
    startAgain: 'Start again',
  },
  tooBroad: { title: TOO_BROAD_TITLE, searchLastDay: 'Search the last 24 hours' },
};

export type AuditPageWords = typeof AUDIT_PAGE_WORDS;
