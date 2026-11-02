import type { ExecutionRequirement } from '@odudu/contracts/admin';

export const REQUIREMENT_OPTIONS: readonly { id: ExecutionRequirement; label: string }[] = [
  { id: 'required', label: 'Required' },
  { id: 'alternative', label: 'Alternative' },
  { id: 'conditional', label: 'Conditional' },
  { id: 'disabled', label: 'Disabled' },
];

const REQUIREMENT_TEXT: Readonly<Record<ExecutionRequirement, string>> = {
  required: 'Every sign-in must pass it.',
  alternative: 'Any one of a run of alternatives is enough.',
  conditional: 'Asked only of a subject it applies to; skipped for the rest.',
  disabled: 'Left in the flow but skipped, as if it were not there.',
};

export function requirementText(requirement: ExecutionRequirement): string {
  return REQUIREMENT_TEXT[requirement];
}

const AUTHENTICATOR_TEXT: Readonly<Record<string, string>> = {
  password: "The subject's password.",
  passkey: 'A passkey registered to the subject.',
  otp: 'A one-time password from an authenticator app.',
  'recovery-code': 'One of the single-use recovery codes issued with a one-time password.',
};

export function authenticatorText(authenticator: string): string {
  return (
    AUTHENTICATOR_TEXT[authenticator] ?? 'An authenticator this console has no description of.'
  );
}

export const OTP = 'otp';

export const FLOW_RULE =
  'The steps run in this order at every sign-in. Alternatives that sit next to each other are one run: passing any of them is enough. The whole list is replaced when you save.';

export const FLOW_TITLE = 'Sign-in flow';

// What a step added to the flow starts as.
export const DEFAULT_ADDED: ExecutionRequirement = 'conditional';

export function requirementOf(id: string): ExecutionRequirement {
  return REQUIREMENT_OPTIONS.find((option) => option.id === id)?.id ?? DEFAULT_ADDED;
}
