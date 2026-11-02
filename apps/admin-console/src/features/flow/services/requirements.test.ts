import { describe, expect, it } from 'vitest';
import {
  authenticatorText,
  DEFAULT_ADDED,
  requirementOf,
  REQUIREMENT_OPTIONS,
  requirementText,
} from '#/features/flow/services/requirements';

describe('REQUIREMENT_OPTIONS', () => {
  it('offers the four requirements the server knows, disabled last', () => {
    expect(REQUIREMENT_OPTIONS.map((o) => o.id)).toEqual([
      'required',
      'alternative',
      'conditional',
      'disabled',
    ]);
  });
});

describe('requirementText', () => {
  it('says what each requirement means', () => {
    expect(requirementText('disabled')).toMatch(/skipped/u);
    expect(requirementText('alternative')).toMatch(/any one/iu);
  });
});

describe('authenticatorText', () => {
  it('describes the four the server registers, and a stranger plainly', () => {
    expect(authenticatorText('password')).toMatch(/password/iu);
    expect(authenticatorText('recovery-code')).toMatch(/recovery/iu);
    expect(authenticatorText('sms')).toBe('An authenticator this console has no description of.');
  });
});

describe('requirementOf', () => {
  it('narrows a chosen id to a requirement, and falls to the one a new step starts as', () => {
    expect(requirementOf('required')).toBe('required');
    expect(requirementOf('nonesuch')).toBe(DEFAULT_ADDED);
    expect(DEFAULT_ADDED).toBe('conditional');
  });
});
