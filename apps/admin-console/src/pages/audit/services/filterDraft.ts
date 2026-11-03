import { ANY_STATUS } from '#/shared/services/filters';
import {
  FILTER_NAMES,
  type AuditFilters,
  type FilterName,
} from '#/pages/audit/services/auditFilters';

export type Draft = Record<FilterName, string>;

export const EMPTY_DRAFT: Draft = {
  event_type: '',
  action: '',
  outcome: '',
  actor_subject_id: '',
  resource_type: '',
  resource_id: '',
  from: '',
  to: '',
};

export function draftOf(filters: AuditFilters): Draft {
  return { ...EMPTY_DRAFT, ...filters };
}

export function filtersOf(draft: Draft): AuditFilters {
  const filters: AuditFilters = {};
  for (const name of FILTER_NAMES) {
    const value = draft[name].trim();
    if (value !== '') filters[name] = value;
  }
  return filters;
}

// What a select shows for a draft field: its option, or "any" while unset.
export function choiceOf(draft: Draft, name: FilterName): string {
  return draft[name] === '' ? ANY_STATUS : draft[name];
}

// Whether the form may take a resource id: it names nothing without its type.
export function hasResourceType(draft: Draft): boolean {
  return draft.resource_type.trim() !== '';
}

// A resource id is meaningless without its type, so the form cannot hold one.
export function withField(draft: Draft, name: FilterName, value: string): Draft {
  const next = { ...draft, [name]: value === ANY_STATUS ? '' : value };
  if (!hasResourceType(next)) next.resource_id = '';
  return next;
}
