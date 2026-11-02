import { useState } from 'react';
import type { RefusalReporter } from '#/shared/repository/useSectionSave';
import { createFailure, type CreateSpec } from '#/shared/services/failure';
import { onlyField, withoutField, type FieldProblem } from '#/shared/services/fieldErrors';
import type { GatewayFailure, GatewayResult } from '#/shared/transport/gateway';

export interface CreationFlow<F extends string> {
  errors: Partial<Record<F, string>>;
  message: string | null;
  // The POST's answer was lost: offer to look for the thing rather than send it again.
  unconfirmed: boolean;
  // A field edited no longer carries what was said of it.
  edited: (field: F) => void;
  // Says what is wrong with a field before anything is sent.
  invalid: (problem: FieldProblem<F>) => void;
  // A send begins: what was said of the last one goes.
  begin: () => void;
  fail: (failure: GatewayFailure, spec: CreateSpec) => void;
  // Sends the creation once: nothing while `blocked` or unconfirmed, nothing
  // with a field problem, and a failure is said under its field.
  submit: <T>(send: {
    blocked: boolean;
    problem: FieldProblem<F> | null;
    spec: CreateSpec;
    create: () => Promise<GatewayResult<T>>;
    made: (created: T) => void;
  }) => void;
  // Looks for what a lost answer may have made, and carries on with it if found.
  check: <T>(look: {
    busy: boolean;
    find: () => Promise<GatewayResult<T | null>>;
    made: (found: T) => void;
    looked: { failed: string; missing: string };
  }) => void;
}

// What the forms that create a named thing share: the errors under their
// fields, the line said beside the action, and the way out of a lost answer.
export function useCreationFlow<F extends string>(refusal: RefusalReporter): CreationFlow<F> {
  const [errors, setErrors] = useState<Partial<Record<F, string>>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);

  const fail = (failure: GatewayFailure, spec: CreateSpec): void => {
    const outcome = createFailure(failure, spec);
    if (outcome.unconfirmed) setUnconfirmed(true);
    if (outcome.report) refusal.report(failure, spec.capability);
    setErrors(outcome.errors);
    setMessage(outcome.message);
  };

  const begin = (): void => {
    setErrors({});
    setMessage(null);
  };

  return {
    errors,
    message,
    unconfirmed,
    edited: (field) => {
      setErrors((was) => withoutField(was, field));
    },
    invalid: ({ field, text }) => {
      setErrors(onlyField(field, text));
    },
    begin,
    fail,
    submit: ({ blocked, problem, spec, create, made }) => {
      if (blocked || unconfirmed) return;
      if (problem !== null) {
        setErrors(onlyField(problem.field, problem.text));
        return;
      }
      begin();
      create()
        .then((result) => {
          if (result.ok) made(result.data);
          else fail(result, spec);
        })
        .catch(() => {
          fail({ ok: false, kind: 'defect' }, spec);
        });
    },
    check: ({ busy, find, made, looked }) => {
      if (busy) return;
      find()
        .then((result) => {
          if (!result.ok) {
            setMessage(looked.failed);
            return;
          }
          if (result.data !== null) {
            made(result.data);
            return;
          }
          setUnconfirmed(false);
          setMessage(looked.missing);
        })
        .catch(() => {
          setMessage(looked.failed);
        });
    },
  };
}
