import type { FieldError } from '@odudu/contracts/admin';

export interface FieldErrors {
  readonly fields: Readonly<Record<string, string>>;
  // Refusals that name no field of this section, shown for the section as a whole.
  readonly other: readonly string[];
}

// `redirect_uris[1]` and `document.name` belong to the field they start with.
function owner(path: string, known: readonly string[]): string | undefined {
  return known.find(
    (field) => path === field || path.startsWith(`${field}.`) || path.startsWith(`${field}[`),
  );
}

const NAMED = /^([A-Za-z_][\w.[\]]*): (.+)$/u;

// Only a refusal without `errors` is read from `detail`, whose prose is the
// admin API's `field: reason` pairs joined by `; `.
function fromDetail(detail: string): FieldError[] | null {
  const parts = detail.split('; ').map((part) => NAMED.exec(part));
  if (parts.some((match) => match === null)) return null;
  return parts.flatMap((match) =>
    match?.[1] === undefined || match[2] === undefined
      ? []
      : [{ path: match[1], message: match[2] }],
  );
}

export function fieldErrorsOf(
  problem: {
    readonly detail?: string | undefined;
    readonly errors?: readonly FieldError[] | undefined;
  },
  known: readonly string[],
): FieldErrors {
  const named = problem.errors ?? (problem.detail === undefined ? [] : fromDetail(problem.detail));
  if (named === null)
    return { fields: {}, other: problem.detail === undefined ? [] : [problem.detail] };
  const fields: Record<string, string> = {};
  const other: string[] = [];
  for (const { path, message } of named) {
    const field = owner(path, known);
    if (field === undefined) {
      other.push(`${path}: ${message}`);
      continue;
    }
    const text = path === field ? message : `${path}: ${message}`;
    const was = fields[field];
    fields[field] = was === undefined ? text : `${was}; ${text}`;
  }
  if (
    problem.errors === undefined &&
    Object.keys(fields).length === 0 &&
    problem.detail !== undefined
  ) {
    return { fields, other: [problem.detail] };
  }
  return { fields, other };
}
