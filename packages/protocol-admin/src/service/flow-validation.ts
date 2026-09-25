import { type ReplaceExecutionsRequest } from '@odudu/contracts/admin';

export type ValidateFlowOutcome =
  | { kind: 'ok' }
  | { kind: 'empty' }
  | { kind: 'unresolvable_authenticator'; name: string; known: readonly string[] }
  | { kind: 'no_enabled_step' };

// A leaf: takes the registry's own names rather than importing the executor
// that owns them, so this is unit-tested without a database and without
// authn-flows on the import graph. Order matters — an unresolvable name is
// reported before an all-disabled list is, so a caller fixing one refusal at
// a time sees the more fundamental one first.
export function validateFlowSteps(
  steps: ReplaceExecutionsRequest,
  knownAuthenticators: readonly string[],
): ValidateFlowOutcome {
  if (steps.length === 0) return { kind: 'empty' };

  for (const step of steps) {
    if (!knownAuthenticators.includes(step.authenticator)) {
      return {
        kind: 'unresolvable_authenticator',
        name: step.authenticator,
        known: knownAuthenticators,
      };
    }
  }

  if (steps.every((step) => step.requirement === 'disabled')) {
    return { kind: 'no_enabled_step' };
  }

  return { kind: 'ok' };
}
