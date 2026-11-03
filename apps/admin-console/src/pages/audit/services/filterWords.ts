import { EVENT_TYPE_OPTIONS, OUTCOME_OPTIONS } from '#/pages/audit/services/filterOptions';
import { NOT_FILTERS } from '#/pages/audit/services/auditFilters';

export const FILTER_WORDS = {
  formLabel: 'Filter the audit trail',
  eventType: { label: 'Event type', options: EVENT_TYPE_OPTIONS },
  outcome: { label: 'Outcome', options: OUTCOME_OPTIONS },
  action: { label: 'Action', description: 'Exactly as logged, such as client.update.' },
  resourceType: {
    label: 'Resource type',
    description: 'Such as client, subject, role, group or scope.',
  },
  resourceId: { label: 'Resource id', needsType: 'Choose a resource type first.' },
  actor: { label: 'Actor (subject id)', description: 'The subject that acted, by its id.' },
  from: { label: 'From', description: 'Events at or after this minute.' },
  to: { label: 'To', description: 'Events up to the end of this minute.' },
  notFilters: NOT_FILTERS,
  apply: 'Apply filters',
  clear: 'Clear filters',
};

export type FilterWords = typeof FILTER_WORDS;
