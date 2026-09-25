import { type ReplaceExecutionsRequest } from '@odudu/contracts/admin';

export type ValidateFlowOutcome =
  | { kind: 'ok' }
  | { kind: 'empty' }
  | { kind: 'unresolvable_authenticator'; name: string; known: readonly string[] }
  | { kind: 'duplicate_authenticator'; name: string }
  | { kind: 'no_enabled_step' };

// A leaf: takes the registry's own names rather than importing the executor
// that owns them, so this is unit-tested without a database and without
// authn-flows on the import graph. Order matters — an unresolvable name is
// reported before a duplicate or an all-disabled list, so a caller fixing
// one refusal at a time sees the more fundamental one first.
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

  // A step is addressed by its authenticator, so a repeat leaves whichever
  // one dispatch reaches first standing for both, and the caller cannot
  // have meant either in particular.
  const seen = new Set<string>();
  for (const step of steps) {
    if (seen.has(step.authenticator)) {
      return { kind: 'duplicate_authenticator', name: step.authenticator };
    }
    seen.add(step.authenticator);
  }

  if (steps.every((step) => step.requirement === 'disabled')) {
    return { kind: 'no_enabled_step' };
  }

  return { kind: 'ok' };
}
