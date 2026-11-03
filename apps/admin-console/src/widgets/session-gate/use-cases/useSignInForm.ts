import { useState, type SubmitEvent } from 'react';
import { signInToLabel } from '#/entities/session';
import { enteredTenant, signInLabel } from '#/widgets/session-gate/services/signInText';

export interface SignInForm {
  asking: boolean;
  tenant: string;
  error: string | undefined;
  signInToLabel: (tenant: string) => string;
  submitLabel: string;
  setTenant: (tenant: string) => void;
  ask: () => void;
  submit: (event: SubmitEvent<HTMLFormElement>) => void;
}

export function useSignInForm({
  remembered,
  enters,
  onSignIn,
  check,
}: {
  remembered: string | null;
  enters: boolean;
  onSignIn: (tenant: string) => void;
  check: (tenant: string) => string | undefined;
}): SignInForm {
  const [asking, setAsking] = useState(remembered === null);
  const [tenant, setTenant] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  return {
    asking,
    tenant,
    error,
    signInToLabel,
    submitLabel: signInLabel(enters, enteredTenant(tenant)),
    setTenant,
    ask: () => {
      setAsking(true);
    },
    submit: (event) => {
      event.preventDefault();
      const name = enteredTenant(tenant);
      const problem = check(name);
      setError(problem);
      if (problem === undefined) onSignIn(name);
    },
  };
}
