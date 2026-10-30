import { isAuditInstant, listAuditQuerySchema } from '@odudu/contracts/admin';
import type { Choice } from '#/shared/service/choice';
import { shortened } from '#/shared/service/format';

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
export type Draft = Record<FilterName, string>;
export type DraftProblems = Partial<Record<FilterName, string>>;

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

// A select's way of saying no filter; a select cannot hold an empty key.
export const ANY = 'any';

const SHAPE = listAuditQuerySchema.shape;
const SHOWN_LENGTH = 40;

function shown(value: string): string {
  return shortened(value, SHOWN_LENGTH);
}

function ignoredText(name: FilterName, value: string): string {
  return `The address names a ${FILTER_LABELS[name]} the trail cannot read (“${shown(value)}”), so it was ignored.`;
}

function isInstant(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

function endsBefore(filters: AuditFilters): boolean {
  const { from, to } = filters;
  return from !== undefined && to !== undefined && Date.parse(to) < Date.parse(from);
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
    const readable = SHAPE[name].safeParse(value).success;
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

export function isFiltered(filters: AuditFilters): boolean {
  return Object.keys(filters).length > 0;
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
  return draft[name] === '' ? ANY : draft[name];
}

// Problems are said once a submit has met them, not while the field is half typed.
export function shownProblems(problems: DraftProblems, attempted: boolean): DraftProblems {
  return attempted ? problems : {};
}

export function isClean(problems: DraftProblems): boolean {
  return Object.keys(problems).length === 0;
}

// Whether the form may take a resource id: it names nothing without its type.
export function hasResourceType(draft: Draft): boolean {
  return draft.resource_type.trim() !== '';
}

// A resource id is meaningless without its type, so the form cannot hold one.
export function withField(draft: Draft, name: FilterName, value: string): Draft {
  const next = { ...draft, [name]: value === ANY ? '' : value };
  if (!hasResourceType(next)) next.resource_id = '';
  return next;
}

const UUID_PROBLEM = 'A subject id is a UUID, such as 0192f7a4-5c1e-7b3a-9d2e-6f8a1b2c3d4e.';
const LENGTH_PROBLEM = 'At most 256 characters.';
const RANGE_PROBLEM = 'To is before From. Choose an end after the start.';

export type Unreadable = Partial<Record<'from' | 'to', string>>;

export function withUnreadable(
  held: Unreadable,
  name: 'from' | 'to',
  message: string | null,
): Unreadable {
  const rest = Object.fromEntries(Object.entries(held).filter(([each]) => each !== name));
  return message === null ? rest : { ...rest, [name]: message };
}

// A date that is typed and reads as no instant narrows nothing, so applying
// would leave the trail looking bounded by it when it is not.
export function applyBlocked(unreadable: Unreadable): string | null {
  return Object.keys(unreadable).length === 0
    ? null
    : 'Correct or clear the date and time marked invalid before applying: the trail is not narrowed by it until then.';
}

export function draftProblems(draft: Draft, unreadable: Unreadable = {}): DraftProblems {
  const held = filtersOf(draft);
  const problems: DraftProblems = { ...unreadable };
  if (
    held.actor_subject_id !== undefined &&
    !SHAPE.actor_subject_id.safeParse(held.actor_subject_id).success
  ) {
    problems.actor_subject_id = UUID_PROBLEM;
  }
  for (const name of ['action', 'resource_type', 'resource_id'] as const) {
    const value = held[name];
    if (value !== undefined && !SHAPE[name].safeParse(value).success) {
      problems[name] = LENGTH_PROBLEM;
    }
  }
  if (
    held.from !== undefined &&
    held.to !== undefined &&
    isInstant(held.from) &&
    endsBefore(held)
  ) {
    problems.to = RANGE_PROBLEM;
  }
  return problems;
}

export const EVENT_TYPE_OPTIONS: readonly Choice[] = [
  { id: ANY, label: 'Any event type' },
  { id: 'admin_mutation', label: 'Admin change' },
  { id: 'admin_access', label: 'Admin access' },
  { id: 'authentication', label: 'Authentication' },
  { id: 'session', label: 'Session' },
  { id: 'token', label: 'Token' },
  { id: 'credential', label: 'Credential' },
];

export const OUTCOME_OPTIONS: readonly Choice[] = [
  { id: ANY, label: 'Any outcome' },
  { id: 'allowed', label: 'Allowed' },
  { id: 'refused', label: 'Refused' },
  { id: 'failed', label: 'Failed' },
];
