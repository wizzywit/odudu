import { describe, expect, it } from 'vitest';
import { validateFlowSteps } from '#/service/flow-validation';

const KNOWN = ['password', 'passkey', 'otp', 'recovery-code'];

describe('validateFlowSteps', () => {
  it('accepts a well-formed flow with at least one enabled step', () => {
    const steps = [
      { authenticator: 'passkey', requirement: 'alternative' as const },
      { authenticator: 'password', requirement: 'alternative' as const },
    ];
    expect(validateFlowSteps(steps, KNOWN)).toEqual({ kind: 'ok' });
  });

  it('refuses an empty list, since a tenant with no flow cannot be logged into', () => {
    expect(validateFlowSteps([], KNOWN)).toEqual({ kind: 'empty' });
  });

  it('refuses an authenticator the registry does not resolve, naming the known set', () => {
    const steps = [{ authenticator: 'bogus', requirement: 'required' as const }];
    expect(validateFlowSteps(steps, KNOWN)).toEqual({
      kind: 'unresolvable_authenticator',
      name: 'bogus',
      known: KNOWN,
    });
  });

  it('refuses a list where every step is disabled', () => {
    const steps = [
      { authenticator: 'password', requirement: 'disabled' as const },
      { authenticator: 'otp', requirement: 'disabled' as const },
    ];
    expect(validateFlowSteps(steps, KNOWN)).toEqual({ kind: 'no_enabled_step' });
  });

  it('accepts a list with at least one enabled step among disabled ones', () => {
    const steps = [
      { authenticator: 'password', requirement: 'required' as const },
      { authenticator: 'otp', requirement: 'disabled' as const },
    ];
    expect(validateFlowSteps(steps, KNOWN)).toEqual({ kind: 'ok' });
  });

  it('reports an unresolvable authenticator before an all-disabled refusal', () => {
    const steps = [{ authenticator: 'bogus', requirement: 'disabled' as const }];
    expect(validateFlowSteps(steps, KNOWN).kind).toBe('unresolvable_authenticator');
  });
});

describe('validateFlowSteps, given the same authenticator twice', () => {
  it('refuses the duplicate rather than letting dispatch order decide', () => {
    const outcome = validateFlowSteps(
      [
        { authenticator: 'password', requirement: 'required' },
        { authenticator: 'password', requirement: 'alternative' },
      ],
      ['password'],
    );

    expect(outcome).toEqual({ kind: 'duplicate_authenticator', name: 'password' });
  });

  it('reports an unresolvable name before a duplicate one', () => {
    const outcome = validateFlowSteps(
      [
        { authenticator: 'nope', requirement: 'required' },
        { authenticator: 'nope', requirement: 'required' },
      ],
      ['password'],
    );

    expect(outcome.kind).toBe('unresolvable_authenticator');
  });
});
