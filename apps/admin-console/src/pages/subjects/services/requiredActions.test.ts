import { describe, expect, it } from 'vitest';
import {
  describeActions,
  requiredActionsInOrder,
  REQUIRED_ACTIONS,
  REQUIRED_ACTION_OPTIONS,
} from '#/pages/subjects/services/requiredActions';

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

describe('required action options', () => {
  it('offers each action by its id with its label and description', () => {
    expect(REQUIRED_ACTION_OPTIONS).toEqual(
      REQUIRED_ACTIONS.map(({ action, label, description }) => ({
        id: action,
        label,
        description,
      })),
    );
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
