import { describe, expect, it } from 'vitest';
import { decideConsent, type ConsentInput } from '#/service/consent';

function input(overrides: Partial<ConsentInput> = {}): ConsentInput {
  return {
    requestedScopes: ['openid', 'profile'],
    defaultScopes: ['openid'],
    optionalScopes: ['profile'],
    grantedScopes: [],
    prompt: new Set(),
    consentRequired: true,
    ...overrides,
  };
}

describe('[OIDC-3.1.2.1-01] decideConsent', () => {
  // The ordering is the point: a flag-first implementation checks
  // consentRequired before prompt and returns not_required here, since the
  // flag is false. Only evaluating prompt=consent first yields ask.
  it('asks when prompt=consent even though the client does not require consent', () => {
    const decision = decideConsent(input({ consentRequired: false, prompt: new Set(['consent']) }));
    expect(decision.kind).toBe('ask');
  });

  // Would also pass under a flag-first ordering, since both orderings agree
  // once consentRequired is false and prompt=consent is absent. Included to
  // pin down case 2 in isolation from case 1.
  it('does not require consent when the client flag is false', () => {
    const decision = decideConsent(input({ consentRequired: false }));
    expect(decision).toEqual({ kind: 'not_required' });
  });

  // Would fail under an implementation that skips the grant-coverage check,
  // e.g. one that always asks once consentRequired is true.
  it('does not require consent when the recorded grant already covers everything requested', () => {
    const decision = decideConsent(
      input({ grantedScopes: ['openid', 'profile'], consentRequired: true }),
    );
    expect(decision).toEqual({ kind: 'not_required' });
  });

  // Would fail under an implementation that narrows the grant to only the
  // requested scopes, or that requires an exact match instead of coverage.
  it('does not require consent when the recorded grant is wider than the request', () => {
    const decision = decideConsent(
      input({
        requestedScopes: ['openid'],
        grantedScopes: ['openid', 'profile', 'email'],
        consentRequired: true,
      }),
    );
    expect(decision).toEqual({ kind: 'not_required' });
  });

  // Would fail under an implementation that names the error something other
  // than consent_required, or that returns ask instead of refuse under
  // prompt=none.
  it('refuses with consent_required when something is missing and prompt=none', () => {
    const decision = decideConsent(
      input({ grantedScopes: [], consentRequired: true, prompt: new Set(['none']) }),
    );
    expect(decision).toEqual({ kind: 'refuse', error: 'consent_required' });
  });

  // Would fail under an implementation that refuses outright instead of
  // asking when prompt is unset and something is missing.
  it('asks when something is missing and prompt does not forbid interaction', () => {
    const decision = decideConsent(input({ grantedScopes: [], consentRequired: true }));
    expect(decision).toEqual({
      kind: 'ask',
      defaultScopes: ['openid'],
      optionalScopes: ['profile'],
      alreadyGranted: [],
    });
  });

  // Would fail under an implementation that pre-ticks default scopes too,
  // or that fails to intersect alreadyGranted with the scopes actually
  // being asked about.
  it('pre-ticks the optional scopes already recorded in an ask', () => {
    const decision = decideConsent(
      input({
        requestedScopes: ['openid', 'profile', 'email'],
        defaultScopes: ['openid'],
        optionalScopes: ['profile', 'email'],
        grantedScopes: ['profile'],
        consentRequired: true,
      }),
    );
    expect(decision).toEqual({
      kind: 'ask',
      defaultScopes: ['openid'],
      optionalScopes: ['profile', 'email'],
      alreadyGranted: ['profile'],
    });
  });
});
