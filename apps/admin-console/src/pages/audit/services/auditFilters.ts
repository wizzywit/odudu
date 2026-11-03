import { listAuditQuerySchema } from '@odudu/contracts/admin';

export const FILTER_NAMES = [
  'event_type',
  'action',
  'outcome',
  'actor_subject_id',
  'resource_type',
  'resource_id',
  'from',
  'to',
] as const;

export type FilterName = (typeof FILTER_NAMES)[number];
export type AuditFilters = Partial<Record<FilterName, string>>;

// How a filter is called in a sentence.
export const FILTER_LABELS: Record<FilterName, string> = {
  event_type: 'event type',
  action: 'action',
  outcome: 'outcome',
  actor_subject_id: 'actor',
  resource_type: 'resource type',
  resource_id: 'resource id',
  from: 'from',
  to: 'to',
};

// What the API accepts of each filter, for the address and the form to judge by.
export const FILTER_SHAPE = listAuditQuerySchema.shape;

export const NOT_FILTERS =
  'The request id, the address a request came from, and the caller’s tenant and client are not filters: the server does not search by them.';

export function isFiltered(filters: AuditFilters): boolean {
  return Object.keys(filters).length > 0;
}

export function endsBefore(filters: AuditFilters): boolean {
  const { from, to } = filters;
  return from !== undefined && to !== undefined && Date.parse(to) < Date.parse(from);
}
