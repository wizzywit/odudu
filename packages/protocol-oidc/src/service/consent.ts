import { type PromptValue } from '#/service/prompt';

export interface ConsentInput {
  requestedScopes: readonly string[];
  defaultScopes: readonly string[];
  optionalScopes: readonly string[];
  grantedScopes: readonly string[];
  prompt: ReadonlySet<PromptValue>;
  consentRequired: boolean;
  // A client nobody at the tenant vetted: registered dynamically or resolved
  // from a metadata document. It is asked about until a grant of its own
  // exists, whatever its flag says, so a request covering no scope it could
  // be granted is not waved through either.
  approvalRequired: boolean;
  approved: boolean;
}

export type ConsentDecision =
  | { kind: 'not_required' }
  | {
      kind: 'ask';
      defaultScopes: string[];
      optionalScopes: string[];
      alreadyGranted: string[];
    }
  | { kind: 'refuse'; error: 'consent_required' };

// Registered over the wire without an administrator's say-so: anonymously,
// or from a metadata document the client's owner publishes.
export function needsApproval(registrationOrigin: string): boolean {
  return registrationOrigin === 'anonymous' || registrationOrigin === 'cimd';
}

// The order below is the design: prompt=consent is checked before the
// client's own flag. OIDC Core §3.1.2.1's SHOULD is addressed to the
// authorization server and conditioned on the request, not on how the
// client was registered — a flag-first check makes the parameter silently
// inert for every seeded and token-registered client.
export function decideConsent(input: ConsentInput): ConsentDecision {
  const requested = new Set(input.requestedScopes);
  const grantedSet = new Set(input.grantedScopes);

  // In the client's own order, which is the one the consent screen shows.
  const askDefault = input.defaultScopes.filter((scope) => requested.has(scope));
  const askOptional = input.optionalScopes.filter((scope) => requested.has(scope));
  const alreadyGranted = askOptional.filter((scope) => grantedSet.has(scope));
  const ask = (): ConsentDecision => ({
    kind: 'ask',
    defaultScopes: askDefault,
    optionalScopes: askOptional,
    alreadyGranted,
  });

  if (input.prompt.has('consent')) return ask();

  if (input.approvalRequired && !input.approved) {
    return input.prompt.has('none') ? { kind: 'refuse', error: 'consent_required' } : ask();
  }

  if (!input.consentRequired) return { kind: 'not_required' };

  // Only over what a grant can actually cover — a requested scope outside
  // the client's declared default/optional vocabulary can never be
  // recorded (consent-submission.ts's recordedNames is built from exactly
  // these two sets), so counting it here would ask on every request
  // forever, with no consent screen able to satisfy the check.
  const missing = [...askDefault, ...askOptional].some((scope) => !grantedSet.has(scope));
  if (!missing) return { kind: 'not_required' };

  if (input.prompt.has('none')) return { kind: 'refuse', error: 'consent_required' };

  return ask();
}
