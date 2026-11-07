import { describe, expect, it } from 'vitest';
import { decideConsent, needsApproval, type ConsentInput } from '#/service/consent';

function input(overrides: Partial<ConsentInput> = {}): ConsentInput {
  return {
    requestedScopes: ['openid', 'profile'],
    defaultScopes: ['openid'],
    optionalScopes: ['profile'],
    grantedScopes: [],
    prompt: new Set(),
    consentRequired: true,
    approvalRequired: false,
    approved: false,
    ...overrides,
  };
}

describe('[OIDC-CORE-3.1.2.1-13] decideConsent', () => {
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

  // Would fail under an implementation that computes coverage over every
  // requested scope: a scope outside the client's declared default/optional
  // vocabulary can never be recorded (consent-submission.ts's recordedNames
  // is built from exactly those two sets), so counting it toward "missing"
  // would ask on every request forever, with no consent screen able to
  // satisfy the check.
  it('does not require consent when only an ungrantable scope is unrecorded', () => {
    const decision = decideConsent(
      input({
        requestedScopes: ['openid', 'profile', 'unknown-scope'],
        defaultScopes: ['openid'],
        optionalScopes: ['profile'],
        grantedScopes: ['openid', 'profile'],
        consentRequired: true,
      }),
    );
    expect(decision).toEqual({ kind: 'not_required' });
  });
});

describe('a client the person has not approved', () => {
  const dynamic = { approvalRequired: true, approved: false };

  it('asks even when the client does not require consent', () => {
    expect(decideConsent(input({ ...dynamic, consentRequired: false })).kind).toBe('ask');
  });

  it('asks when the request names nothing a grant could cover', () => {
    const decision = decideConsent(input({ ...dynamic, requestedScopes: ['unlisted'] }));
    expect(decision).toMatchObject({ kind: 'ask', defaultScopes: [], optionalScopes: [] });
  });

  it('refuses under prompt=none, where nothing can be asked', () => {
    const decision = decideConsent(input({ ...dynamic, prompt: new Set(['none']) }));
    expect(decision).toEqual({ kind: 'refuse', error: 'consent_required' });
  });

  it("follows the client's own rules once a grant of its exists", () => {
    const approved = { approvalRequired: true, approved: true };
    expect(
      decideConsent(input({ ...approved, consentRequired: false, grantedScopes: ['openid'] })),
    ).toEqual({ kind: 'not_required' });
    expect(decideConsent(input({ ...approved, grantedScopes: ['openid'] })).kind).toBe('ask');
  });

  it('is not asked of a client registered by an administrator', () => {
    expect(decideConsent(input({ consentRequired: false })).kind).toBe('not_required');
  });
});

describe('needsApproval', () => {
  it.each([
    ['anonymous', true],
    ['cimd', true],
    ['seeded', false],
    ['operator', false],
    ['token', false],
  ])('%s: %s', (origin, expected) => {
    expect(needsApproval(origin)).toBe(expected);
  });
});

describe('the write scope is approved afresh every time', () => {
  const write = (overrides: Partial<ConsentInput> = {}) =>
    input({
      requestedScopes: ['openid', 'mcp:write'],
      optionalScopes: ['mcp:write'],
      consentRequired: false,
      ...overrides,
    });

  it('asks for a client that does not require consent', () => {
    expect(decideConsent(write())).toMatchObject({ kind: 'ask', optionalScopes: ['mcp:write'] });
  });

  it('asks again whatever grant is recorded, and does not tick the box for the person', () => {
    const decision = decideConsent(
      write({ consentRequired: true, grantedScopes: ['openid', 'mcp:write'] }),
    );
    expect(decision).toMatchObject({ kind: 'ask', alreadyGranted: [] });
  });

  it('asks for a client whose approval is already recorded', () => {
    expect(decideConsent(write({ approvalRequired: true, approved: true })).kind).toBe('ask');
  });

  it('asks when the scope is one of the defaults, which has no box', () => {
    const decision = decideConsent(
      write({ defaultScopes: ['openid', 'mcp:write'], optionalScopes: [] }),
    );
    expect(decision).toMatchObject({ kind: 'ask', defaultScopes: ['openid', 'mcp:write'] });
  });

  it('refuses with consent_required under prompt=none instead of issuing', () => {
    expect(decideConsent(write({ prompt: new Set(['none']) }))).toEqual({
      kind: 'refuse',
      error: 'consent_required',
    });
    expect(
      decideConsent(
        write({ consentRequired: true, grantedScopes: ['mcp:write'], prompt: new Set(['none']) }),
      ),
    ).toEqual({ kind: 'refuse', error: 'consent_required' });
  });

  it('leaves a request for mcp:read alone', () => {
    expect(
      decideConsent(
        input({
          requestedScopes: ['openid', 'mcp:read'],
          optionalScopes: ['mcp:read'],
          consentRequired: false,
        }),
      ),
    ).toEqual({ kind: 'not_required' });
  });

  it('does not ask for a scope the client could never be granted', () => {
    expect(decideConsent(write({ optionalScopes: [], defaultScopes: ['openid'] }))).toEqual({
      kind: 'not_required',
    });
  });
});
