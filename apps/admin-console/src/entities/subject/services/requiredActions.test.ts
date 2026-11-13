import { requiredActionSchema } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import {
  APPLICATION_ACTIONS,
  describeActions,
  LINKED_ACTION_OPTIONS,
  linkedActionsInOrder,
  requiredActionsInOrder,
  REQUIRED_ACTIONS,
  REQUIRED_ACTION_OPTIONS,
} from '#/entities/subject/services/requiredActions';

describe('required actions', () => {
  it('words each action, in the order the next sign-in asks for them', () => {
    expect(REQUIRED_ACTIONS.map((action) => action.label)).toEqual([
      'Verify the email address',
      'Choose a new password',
      'Set up an authenticator app',
      'Register a passkey',
      'Generate recovery codes',
      'Complete the profile',
      'Accept the terms',
    ]);
  });

  it('follows the vocabulary the admin API takes, in its order', () => {
    expect(REQUIRED_ACTIONS.map((action) => action.action)).toEqual(requiredActionSchema.options);
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

describe('the actions a mailed link may carry', () => {
  it('are the four it can finish, and the rest are not offered', () => {
    expect(LINKED_ACTION_OPTIONS.map((option) => option.id)).toEqual([
      'update-password',
      'configure-totp',
      'configure-passkey',
      'generate-recovery-codes',
    ]);
    expect(linkedActionsInOrder(['accept-terms', 'configure-totp', 'verify-email'])).toEqual([
      'configure-totp',
    ]);
  });
});

describe('the actions an application may start', () => {
  it('are all but the tenant’s terms', () => {
    expect(APPLICATION_ACTIONS.map((action) => action.action)).toEqual([
      'verify-email',
      'update-password',
      'configure-totp',
      'configure-passkey',
      'generate-recovery-codes',
      'update-profile',
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
