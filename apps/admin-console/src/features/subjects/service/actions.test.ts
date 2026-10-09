import { describe, expect, it } from 'vitest';
import {
  describeActions,
  requiredActionsInOrder,
  REQUIRED_ACTIONS,
} from '#/features/subjects/service/actions.ts';

describe('required actions', () => {
  it('words each action the way the mailed link does', () => {
    expect(REQUIRED_ACTIONS.map((action) => action.label)).toEqual([
      'Choose a new password',
      'Set up an authenticator app',
      'Register a passkey',
      'Generate recovery codes',
    ]);
  });
});

describe('required actions', () => {
  it('keeps the order the next sign-in asks for them', () => {
    expect(requiredActionsInOrder(['configure-totp', 'update-password', 'nonsense'])).toEqual([
      'update-password',
      'configure-totp',
    ]);
  });

  it('names those chosen in that order, or none', () => {
    expect(describeActions(['configure-totp', 'update-password'])).toBe(
      'Choose a new password, Set up an authenticator app',
    );
    expect(describeActions([])).toBe('none');
    expect(describeActions('x')).toBe('none');
  });
});
