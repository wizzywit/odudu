import { withoutField } from '#/shared/services/fieldErrors';
import { endsBefore, FILTER_SHAPE, type FilterName } from '#/pages/audit/services/auditFilters';
import { filtersOf, type Draft } from '#/pages/audit/services/filterDraft';

export type DraftProblems = Partial<Record<FilterName, string>>;
export type Unreadable = Partial<Record<'from' | 'to', string>>;

const UUID_PROBLEM = 'A subject id is a UUID, such as 0192f7a4-5c1e-7b3a-9d2e-6f8a1b2c3d4e.';
const LENGTH_PROBLEM = 'At most 256 characters.';
const RANGE_PROBLEM = 'To is before From. Choose an end after the start.';

function isInstant(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

// Problems are said once a submit has met them, not while the field is half typed.
export function shownProblems(problems: DraftProblems, attempted: boolean): DraftProblems {
  return attempted ? problems : {};
}

export function isClean(problems: DraftProblems): boolean {
  return Object.keys(problems).length === 0;
}

export function withUnreadable(
  held: Unreadable,
  name: 'from' | 'to',
  message: string | null,
): Unreadable {
  const rest = withoutField(held, name);
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
    !FILTER_SHAPE.actor_subject_id.safeParse(held.actor_subject_id).success
  ) {
    problems.actor_subject_id = UUID_PROBLEM;
  }
  for (const name of ['action', 'resource_type', 'resource_id'] as const) {
    const value = held[name];
    if (value !== undefined && !FILTER_SHAPE[name].safeParse(value).success) {
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
