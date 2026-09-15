import { describe, expect, it } from 'vitest';
import { nextStep } from '#/service/requirements';

const step = (authenticator: string, requirement: string, applicable = true) =>
  ({ authenticator, requirement, applicable }) as Parameters<typeof nextStep>[0][number];

const passkeyAlternative = step('passkey', 'alternative');
const passwordAlternative = step('password', 'alternative');
const otpConditional = step('otp', 'conditional');

const flow = [passkeyAlternative, passwordAlternative, otpConditional];

const state = (...satisfied: string[]) => ({ satisfied: new Set(satisfied) });

describe('nextStep', () => {
  it('offers the first alternative of a fresh flow', () => {
    expect(nextStep(flow, state())).toEqual({ kind: 'run', authenticator: 'passkey' });
  });

  it('treats one satisfied alternative as satisfying the whole group', () => {
    expect(nextStep(flow, state('password'))).toEqual({ kind: 'run', authenticator: 'otp' });
  });

  it('completes when the conditional step is not applicable', () => {
    const noOtp = [passkeyAlternative, passwordAlternative, step('otp', 'conditional', false)];
    expect(nextStep(noOtp, state('password'))).toEqual({ kind: 'complete' });
  });

  it('completes once every group and applicable step is satisfied', () => {
    expect(nextStep(flow, state('password', 'otp'))).toEqual({ kind: 'complete' });
  });

  it('skips a disabled step entirely', () => {
    const disabled = [step('passkey', 'disabled'), step('password', 'alternative')];
    expect(nextStep(disabled, state())).toEqual({ kind: 'run', authenticator: 'password' });
  });

  it('requires every required step, with no grouping', () => {
    const required = [step('password', 'required'), step('otp', 'required')];
    expect(nextStep(required, state('password'))).toEqual({ kind: 'run', authenticator: 'otp' });
    expect(nextStep(required, state('password', 'otp'))).toEqual({ kind: 'complete' });
  });

  it('groups only adjacent alternatives, so a required step between them splits the group', () => {
    const split = [
      step('passkey', 'alternative'),
      step('password', 'required'),
      step('recovery-code', 'alternative'),
    ];
    // Satisfying the first group does not satisfy the second.
    expect(nextStep(split, state('passkey'))).toEqual({ kind: 'run', authenticator: 'password' });
    expect(nextStep(split, state('passkey', 'password'))).toEqual({
      kind: 'run',
      authenticator: 'recovery-code',
    });
  });

  it('fails a flow with no applicable step at all rather than completing it', () => {
    const none = [step('passkey', 'alternative', false), step('password', 'alternative', false)];
    expect(nextStep(none, state())).toEqual({ kind: 'fail' });
  });

  it('fails an empty flow', () => {
    expect(nextStep([], state())).toEqual({ kind: 'fail' });
  });

  // Not settled by the brief: a disabled execution is skipped "as though
  // absent", so two alternative runs separated only by one merge into a
  // single group, exactly as they would if the disabled entry had never
  // been in the list.
  it('merges two alternative runs across a disabled step that separates them', () => {
    const spanned = [
      step('passkey', 'alternative'),
      step('u2f', 'disabled'),
      step('password', 'alternative'),
    ];
    expect(nextStep(spanned, state('password'))).toEqual({ kind: 'complete' });
  });
});
