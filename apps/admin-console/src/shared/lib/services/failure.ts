import { subjectRefusal, writeRefusal } from '#/shared/lib/services/capabilities';
import { fieldErrorsOf } from '#/shared/lib/services/fieldErrors';
import { sentence } from '#/shared/lib/services/format';
import { NAME_TAKEN } from '#/shared/lib/services/labels';
import type { AdminCapability } from '#/shared/lib/services/principal';
import type { GatewayFailure, GatewayResult, Problem } from '#/shared/lib/services/result';

export const CONSOLE_FAULT = 'This is a fault in the console, not something you did.';

export const COULD_NOT_FINISH = `The console could not finish. ${CONSOLE_FAULT}`;

function hasStatus(result: GatewayResult<unknown>, status: number): boolean {
  return !result.ok && result.kind === 'problem' && result.problem.status === status;
}

// A write sent with no If-Match on purpose that the server refuses as
// required has met a resource that gained an ETag meanwhile: that is a stale
// read like any other, so it is answered the way a 412 is.
export function staleWhenTagMissing<T>(result: GatewayResult<T>): GatewayResult<T> {
  if (result.ok || result.kind !== 'problem' || result.problem.status !== 428) return result;
  return {
    ...result,
    problem: { ...result.problem, status: 412, title: 'Precondition Failed' },
  };
}

export function isRefused(result: GatewayResult<unknown>): boolean {
  return hasStatus(result, 403);
}

// The If-Match no longer names the record: somebody else changed it.
export function isStale(result: GatewayResult<unknown>): boolean {
  return hasStatus(result, 412);
}

// The admin API answers a tenant it does not know with a plain 401, and the
// gateway passes that through with the session kept; a 401 that ended the
// session carries the gateway's own problem type instead.
export function isUnknownTenant(result: GatewayResult<unknown> | undefined): boolean {
  return (
    result?.ok === false &&
    result.kind === 'problem' &&
    result.problem.status === 401 &&
    result.problem.type === 'about:blank'
  );
}

// The server refuses a cursor it did not issue under these filters, or one
// past its life, by naming the cursor field; the page it led to is gone, not
// the list.
export function isStaleCursor(failure: GatewayFailure | null): boolean {
  return (
    failure?.kind === 'problem' &&
    failure.problem.status === 400 &&
    failure.problem.errors?.some((error) => error.path === 'cursor') === true
  );
}

// The part of a problem's type after `#`, the name an endpoint gives its own
// refusals, or empty for a plain status.
export function problemSubtype(problem: Problem): string {
  return problem.type.split('#')[1] ?? '';
}

export function isMissing(result: GatewayResult<unknown>): boolean {
  return hasStatus(result, 404);
}

export interface WriteCopy {
  // What was written to, as the page names it.
  name: string;
  // Past participle: "deleted", "enabled".
  verb: string;
  // Where to look to tell whether it happened, after "look at".
  lookAt: string;
  refused?: (problem: Problem) => string | null;
  stale?: string;
  missing?: string;
}

// A name that begins a sentence, as it reads inside one: "The secret" after "whether".
function lowered(name: string): string {
  return name.startsWith('The ') ? `t${name.slice(1)}` : name;
}

// What a failed write says. A lost answer is never a reason to send again,
// and the console's own mistakes are never put to the user as theirs.
export function writeFailureText(failure: GatewayFailure, copy: WriteCopy): string {
  const { name, verb } = copy;
  const within = lowered(name);
  switch (failure.kind) {
    case 'network':
      return `Could not confirm whether ${within} was ${verb}. It has not been sent again; look at ${copy.lookAt} before trying again.`;
    case 'schema':
      return `${name} may have been ${verb}, but the answer could not be read. Reload to check.`;
    case 'defect':
      return `The console could not finish, so ${within} was not ${verb}. ${CONSOLE_FAULT}`;
    case 'problem': {
      const { problem } = failure;
      if (problem.status === 412 && copy.stale !== undefined) return copy.stale;
      if (problem.status === 404 && copy.missing !== undefined) return copy.missing;
      return (
        copy.refused?.(problem) ?? `${name} was not ${verb}: ${problem.detail ?? problem.title}`
      );
    }
  }
}

export type FailureKind = GatewayFailure['kind'];

// What a feature says in place of the default for each kind of failure; a
// `problem` override is handed the problem and is not given the copy's
// stale, missing or refused wording to defer to.
export interface FailureOverrides {
  network?: () => string;
  schema?: () => string;
  defect?: () => string;
  problem?: (problem: Problem) => string;
}

// Reached only through the overload that names every kind.
const UNUSED_COPY: WriteCopy = { name: 'It', verb: 'done', lookAt: 'the page' };

// A failure's text with some kinds worded by the feature and the rest by
// writeFailureText: with every kind worded no copy is needed.
export function failureTextWith(
  overrides: Required<FailureOverrides>,
): (failure: GatewayFailure) => string;
export function failureTextWith(
  overrides: FailureOverrides,
  copy: WriteCopy,
): (failure: GatewayFailure) => string;
export function failureTextWith(
  overrides: FailureOverrides,
  copy: WriteCopy = UNUSED_COPY,
): (failure: GatewayFailure) => string {
  return (failure) => {
    if (failure.kind === 'problem') {
      return overrides.problem?.(failure.problem) ?? writeFailureText(failure, copy);
    }
    return overrides[failure.kind]?.() ?? writeFailureText(failure, copy);
  };
}

// The refusal wording of a write that needs `capability`, for a spec's `refused`.
export function refusedBy(
  capability: AdminCapability = 'manage-tenant',
): (problem: Problem) => string | null {
  return (problem) => writeRefusal(problem, capability);
}

export interface RemovalSpec {
  // What the page says once the thing is gone.
  doneText: string;
  // Said for a 404, which is the outcome the caller wanted too. Absent when a
  // 404 means something else and goes to `refused`.
  alreadyGoneText?: string;
}

export interface RemovalOutcome {
  // The thing is where the action meant it to be, whoever put it there.
  done: boolean;
  // Not done, and what was asked is out of date: the dialog closes and the
  // text is told over the page, which has been read again.
  closes?: boolean;
  text: string;
}

export function removalOutcome(
  result: GatewayResult<unknown>,
  spec: RemovalSpec,
  copy: WriteCopy,
): RemovalOutcome {
  if (result.ok) return { done: true, text: spec.doneText };
  if (spec.alreadyGoneText !== undefined && isMissing(result)) {
    return { done: true, text: spec.alreadyGoneText };
  }
  return { done: false, text: writeFailureText(result, copy) };
}

export interface CreateSpec {
  // "group", "role": the thing being made.
  noun: string;
  name: string;
  // The form's fields, which a rejection is placed under.
  fields: readonly string[];
  // Where a 409 lands, and what it says when the server says nothing.
  taken?: { field: string; fallback: string };
  capability: AdminCapability;
  // Said when the answer arrived but could not be read, if not as a lost one.
  schema?: string;
  refused?: (problem: Problem) => string | null;
}

// A thing made from a name and a description, as roles and scopes are.
export function namedCreation(noun: string, name: string): CreateSpec {
  return {
    noun,
    name,
    fields: ['name', 'description'],
    taken: { field: 'name', fallback: NAME_TAKEN },
    capability: 'manage-tenant',
  };
}

export interface CreateOutcome {
  // The answer was lost: offer a look rather than another send.
  unconfirmed: boolean;
  errors: Partial<Record<string, string>>;
  message: string | null;
  // A refusal: whoami may have changed.
  report: boolean;
}

export function createFailure(failure: GatewayFailure, spec: CreateSpec): CreateOutcome {
  const none = { unconfirmed: false, errors: {}, message: null, report: false };
  switch (failure.kind) {
    case 'network':
    case 'schema':
      return {
        ...none,
        unconfirmed: true,
        message:
          failure.kind === 'schema' && spec.schema !== undefined
            ? spec.schema
            : `Could not confirm whether ${spec.name} was created. It has not been sent again; look for it before trying again.`,
      };
    case 'defect':
      return {
        ...none,
        message: `The console could not create the ${spec.noun}. ${CONSOLE_FAULT}`,
      };
    case 'problem': {
      const { problem } = failure;
      if (problem.status === 409 && spec.taken !== undefined) {
        return {
          ...none,
          errors: { [spec.taken.field]: sentence(problem.detail ?? spec.taken.fallback) },
        };
      }
      const refused = (spec.refused ?? refusedBy(spec.capability))(problem);
      if (refused !== null) return { ...none, message: refused, report: true };
      const placed = fieldErrorsOf(problem, spec.fields);
      return {
        ...none,
        errors: placed.fields,
        message: placed.other.length === 0 ? null : placed.other.join(' '),
      };
    }
  }
}

export function lookupText(
  noun: string,
  name: string,
  where?: string,
): { failed: string; missing: string } {
  const there = where === undefined ? '' : ` ${where}`;
  return {
    failed: `Could not look for ${name}. Try again.`,
    missing: `No ${noun} named ${name} was found${there}, so it was not created. Creating it again is safe.`,
  };
}

export function createdText(name: string): string {
  return `${name} was created.`;
}

export function deletedText(name: string): string {
  return `${name} was deleted.`;
}

export function enabledText(name: string, enabled: boolean): string {
  return `${name} is ${enabled ? 'enabled' : 'disabled'}.`;
}

export function changeFailureText(failure: GatewayFailure, capability: AdminCapability): string {
  return failureTextWith({
    network: () =>
      'Could not confirm the result. Nothing was sent again; the tab shows what the server holds now.',
    schema: () =>
      'It may have happened, but the answer could not be read. The tab shows what the server holds now.',
    defect: () => COULD_NOT_FINISH,
    problem: ({ status, detail, title }) => {
      if (status === 403) return `Refused: ${subjectRefusal('the subject', capability)}`;
      if (status === 404) return 'It is already gone.';
      return `Refused: ${detail ?? title}`;
    },
  })(failure);
}
