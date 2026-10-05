import { writeRefusal } from '#/shared/service/capabilities.ts';
import { fieldErrorsOf } from '#/shared/service/fieldErrors.ts';
import { sentence } from '#/shared/service/format.ts';
import type { GatewayFailure, GatewayResult, Problem } from '#/shared/service/result.ts';

function hasStatus(result: GatewayResult<unknown>, status: number): boolean {
  return !result.ok && result.kind === 'problem' && result.problem.status === status;
}

export function isRefused(result: GatewayResult<unknown>): boolean {
  return hasStatus(result, 403);
}

// The If-Match no longer names the record: somebody else changed it.
export function isStale(result: GatewayResult<unknown>): boolean {
  return hasStatus(result, 412);
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

// What a failed write says. A lost answer is never a reason to send again,
// and the console's own mistakes are never put to the user as theirs.
export function writeFailureText(failure: GatewayFailure, copy: WriteCopy): string {
  const { name, verb } = copy;
  switch (failure.kind) {
    case 'network':
      return `Could not confirm whether ${name} was ${verb}. It has not been sent again; look at ${copy.lookAt} before trying again.`;
    case 'schema':
      return `${name} may have been ${verb}, but the answer could not be read. Reload to check.`;
    case 'defect':
      return `The console could not finish, so ${name} was not ${verb}. This is a fault in the console, not something you did.`;
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

export interface CreateSpec {
  // "group", "role": the thing being made.
  noun: string;
  name: string;
  // The form's fields, which a rejection is placed under.
  fields: readonly string[];
  // Where a 409 lands, and what it says when the server says nothing.
  taken?: { field: string; fallback: string };
  capability: string;
  refused?: (problem: Problem) => string | null;
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
        message: `Could not confirm whether ${spec.name} was created. It has not been sent again; look for it before trying again.`,
      };
    case 'defect':
      return {
        ...none,
        message: `The console could not create the ${spec.noun}. This is a fault in the console, not something you did.`,
      };
    case 'problem': {
      const { problem } = failure;
      if (problem.status === 409 && spec.taken !== undefined) {
        return {
          ...none,
          errors: { [spec.taken.field]: sentence(problem.detail ?? spec.taken.fallback) },
        };
      }
      const refused = (spec.refused ?? ((p) => writeRefusal(p, spec.capability)))(problem);
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
