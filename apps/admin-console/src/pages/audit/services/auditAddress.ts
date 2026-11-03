import { isAuditInstant } from '@odudu/contracts/admin';
import { shortened } from '#/shared/lib/services/format';
import {
  endsBefore,
  FILTER_LABELS,
  FILTER_NAMES,
  FILTER_SHAPE,
  type AuditFilters,
  type FilterName,
} from '#/pages/audit/services/auditFilters';

const SHOWN_LENGTH = 40;

function shown(value: string): string {
  return shortened(value, SHOWN_LENGTH);
}

function ignoredText(name: FilterName, value: string): string {
  return `The address names a ${FILTER_LABELS[name]} the trail cannot read (“${shown(value)}”), so it was ignored.`;
}

function validValues(params: URLSearchParams): {
  filters: AuditFilters;
  ignored: readonly string[];
} {
  const filters: AuditFilters = {};
  const ignored: string[] = [];
  for (const name of FILTER_NAMES) {
    const value = params.get(name);
    if (value === null || value === '') continue;
    const readable = FILTER_SHAPE[name].safeParse(value).success;
    const inRange = (name !== 'from' && name !== 'to') || isAuditInstant(value);
    if (readable && inRange) filters[name] = value;
    else ignored.push(ignoredText(name, value));
  }
  return { filters, ignored };
}

const NEEDS_TYPE = 'The address names a resource id with no resource type, so the id was ignored.';
const BACKWARDS =
  'The address names a range that ends before it starts, so both ends were ignored.';

// What the address holds that the trail can read; whatever it cannot is
// named, so the page says what it left out rather than failing on it.
export function readFilters(params: URLSearchParams): {
  filters: AuditFilters;
  ignored: readonly string[];
} {
  const { filters, ignored } = validValues(params);
  const extra: string[] = [];
  if (filters.resource_id !== undefined && filters.resource_type === undefined) {
    delete filters.resource_id;
    extra.push(NEEDS_TYPE);
  }
  if (endsBefore(filters)) {
    delete filters.from;
    delete filters.to;
    extra.push(BACKWARDS);
  }
  return { filters, ignored: [...ignored, ...extra] };
}

export function auditQuery(filters: AuditFilters): URLSearchParams {
  const query = new URLSearchParams();
  for (const name of FILTER_NAMES) {
    const value = filters[name];
    if (value !== undefined) query.set(name, value);
  }
  return query;
}

// A cursor is bound to the filters it was issued under, so any change to
// them drops the trail and the list starts again from its first page.
export function filtersToSearch(base: URLSearchParams, filters: AuditFilters): URLSearchParams {
  const search = new URLSearchParams(base);
  search.delete('after');
  for (const name of FILTER_NAMES) search.delete(name);
  for (const [name, value] of auditQuery(filters)) search.set(name, value);
  return search;
}
