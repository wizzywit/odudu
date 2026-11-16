import type { ExecutionRequirement } from '#/pages/flow/types/executions';

export const REQUIREMENT_OPTIONS: readonly { id: ExecutionRequirement; label: string }[] = [
  { id: 'required', label: 'Required' },
  { id: 'alternative', label: 'Alternative' },
  { id: 'conditional', label: 'Conditional' },
  { id: 'disabled', label: 'Disabled' },
];

// Only what the section's rule does not already say: it explains required, alternative and
// conditional once, so a row speaks only of a step that is switched off.
const REQUIREMENT_TEXT: Readonly<Partial<Record<ExecutionRequirement, string>>> = {
  disabled: 'Left in the flow but skipped, as if it were not there.',
};

export function requirementText(requirement: ExecutionRequirement): string | null {
  return REQUIREMENT_TEXT[requirement] ?? null;
}

export const OTP = 'otp';

// What a step added to the flow starts as.
export const DEFAULT_ADDED: ExecutionRequirement = 'conditional';

export function requirementOf(id: string): ExecutionRequirement {
  return REQUIREMENT_OPTIONS.find((option) => option.id === id)?.id ?? DEFAULT_ADDED;
}
