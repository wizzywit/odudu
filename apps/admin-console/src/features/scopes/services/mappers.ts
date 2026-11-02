import type { GatewayFailure } from '#/shared/services/result';
import { andList } from '#/shared/services/format';
import type { Choice } from '#/shared/services/choice';

export const NONE_TEXT = 'Nothing bound. No mapper runs by default, so this scope adds no claims.';

export const DEFAULT_MAPPER_NOTE = 'Used because nothing is bound';

// A mapper the scope runs only because nothing is bound: shown ticked, and
// greyed, since a tick on it would bind nothing that is not already used.
export interface MapperOption extends Choice {
  unavailable?: string;
}

export interface MapperChecklist {
  options: readonly MapperOption[];
  value: readonly string[];
}

// While nothing is bound, the registry's mappers that declare the scope are
// what issuance runs, so they are what the list shows ticked.
function implicitMappers(
  available: readonly string[],
  declared: readonly string[],
  bound: readonly string[],
): readonly string[] {
  return bound.length > 0 ? [] : available.filter((name) => declared.includes(name));
}

export function mapperChecklist(
  available: readonly string[],
  declared: readonly string[],
  bound: readonly string[],
): MapperChecklist {
  const implicit = implicitMappers(available, declared, bound);
  return {
    options: available.map((name) =>
      implicit.includes(name)
        ? { id: name, label: name, unavailable: DEFAULT_MAPPER_NOTE }
        : { id: name, label: name },
    ),
    value: bound.length > 0 ? bound : implicit,
  };
}

// What a tick leaves bound: the defaults shown ticked were never bound, so
// they drop out once another mapper is, and the registry's order is kept.
export function boundAfter(
  available: readonly string[],
  declared: readonly string[],
  bound: readonly string[],
  ticked: readonly string[],
): string[] {
  const implicit = implicitMappers(available, declared, bound);
  return available.filter((name) => ticked.includes(name) && !implicit.includes(name));
}

// While nothing is bound, issuance runs the mappers that declare the scope.
export function mappersSummary(bound: readonly string[], declared: readonly string[]): string {
  if (bound.length > 0) return `Bound: ${andList(bound)}.`;
  if (declared.length === 0) return NONE_TEXT;
  return 'Nothing bound. These mappers run by default.';
}

const UNKNOWN = /^unknown mapper name\(s\): (.+); known: (.+)$/u;

// Null for a failure with nothing to add to the shared wording.
export function mappersFailureText(failure: GatewayFailure): string | null {
  if (failure.kind !== 'problem' || failure.problem.status !== 400) return null;
  const found = UNKNOWN.exec(failure.problem.detail ?? '');
  if (found === null) return null;
  const [, unknown = '', known = ''] = found;
  return `Not saved: no mapper named ${unknown}. The mappers are ${andList(known.split(', '))}.`;
}

// The failure with an unknown mapper's refusal worded to name the registry,
// and any other failure as it came.
export function mappersFailure<F extends GatewayFailure>(failure: F): F {
  const text = mappersFailureText(failure);
  if (text === null || failure.kind !== 'problem') return failure;
  return {
    ...failure,
    problem: { ...failure.problem, errors: [{ path: 'mapper_names', message: text }] },
  };
}
