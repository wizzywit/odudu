import { OVERVIEW } from '#/entities/area';
import { UNCHECKED_LEAD, unreadableTitle } from '#/features/overview/services/panelText';

// What each panel says that is not data: one group per panel, read from the
// use-case and handed to the view.
export const OVERVIEW_WORDS = {
  attention: {
    title: 'Needs attention',
    checking: 'Checking what needs attention',
    clear: 'Nothing needs attention.',
    uncheckedLead: UNCHECKED_LEAD,
    failed: 'Some checks could not run.',
    retry: 'Check again',
  },
  counts: {
    title: 'Counts',
    counting: 'Counting…',
    needsBefore: 'Needs the ',
    needsAfter: ' capability.',
    failed: 'Could not be counted',
    retry: 'Try again',
  },
  discovery: {
    title: 'Discovery',
    loading: 'Loading the discovery document',
    failedTitle: unreadableTitle('discovery document'),
    issuer: 'Issuer',
    document: 'Discovery document',
    endpoints: 'Endpoints',
    supported: 'Supported values',
    keys: 'Published keys',
    keysLoading: 'Loading the published keys',
    keysFailedTitle: unreadableTitle('JWKS'),
    keysTable: 'Published keys',
    lanesNote: "Each key's lane",
    rawKeys: 'Raw JWKS',
    rawKeysCopy: 'JWKS',
    rawDocument: 'Raw discovery document',
    rawDocumentCopy: 'discovery document',
    issuerCopy: 'issuer',
    keyIdCopy: 'key id',
    none: 'none',
    laneUnknown: 'not known',
    columns: {
      kid: 'Key id',
      kty: 'Type',
      alg: 'Algorithm',
      use: 'Use',
      lane: 'Lane',
    },
  },
  audit: {
    title: 'Latest activity',
    open: 'Open the audit trail',
    needs: 'The audit trail',
    loading: 'Loading the latest audit rows',
    failedTitle: 'The audit trail could not be read',
    empty: 'Nothing recorded yet',
    emptyText: 'Every change made in this tenant, and every change refused, is listed here.',
    table: 'Latest audit rows',
  },
} as const;

export type OverviewWords = typeof OVERVIEW_WORDS;

export function overviewTitle(): string {
  return OVERVIEW.label;
}
