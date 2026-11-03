import { useState, type Dispatch, type SetStateAction } from 'react';
import { useRefusal } from '#/entities/session';
import type { Creation } from '#/entities/creation-draft';
import { stepRefusal, type StepCall } from '#/pages/tenants/services/creationCall';
import { SYSTEM_TENANT } from '#/shared/services/principal';
import type { GatewayFailure } from '#/shared/transport/gateway';

type Errors = Partial<Record<string, string>>;

// What a creation step shows beside its form: the errors under the fields,
// the line said beside the action, a lost answer, and a look under way.
export interface StepFeedback {
  errors: Errors;
  setErrors: Dispatch<SetStateAction<Errors>>;
  message: string | null;
  setMessage: (message: string | null) => void;
  unconfirmed: boolean;
  setUnconfirmed: (unconfirmed: boolean) => void;
  checking: boolean;
  setChecking: (checking: boolean) => void;
  // Moves to the next step with nothing left of the last one's feedback.
  move: (next: Creation) => void;
  refused: (call: StepCall, failure: GatewayFailure) => void;
}

export function useStepFeedback(update: (creation: Creation) => void): StepFeedback {
  const refusal = useRefusal(SYSTEM_TENANT);
  const [errors, setErrors] = useState<Errors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [checking, setChecking] = useState(false);
  return {
    errors,
    setErrors,
    message,
    setMessage,
    unconfirmed,
    setUnconfirmed,
    checking,
    setChecking,
    move: (next) => {
      setErrors({});
      setMessage(null);
      setUnconfirmed(false);
      update(next);
    },
    refused: (call, failure) => {
      refusal.report(failure, call.needed);
      const outcome = stepRefusal(failure, call);
      setUnconfirmed(outcome.unconfirmed);
      if (outcome.errors !== null) setErrors(outcome.errors);
      setMessage(outcome.message);
    },
  };
}
