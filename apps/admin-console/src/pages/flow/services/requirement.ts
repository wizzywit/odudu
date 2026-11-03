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

export const OTP = 'otp';

// What a step added to the flow starts as.
export const DEFAULT_ADDED: ExecutionRequirement = 'conditional';

export function requirementOf(id: string): ExecutionRequirement {
  return REQUIREMENT_OPTIONS.find((option) => option.id === id)?.id ?? DEFAULT_ADDED;
}
