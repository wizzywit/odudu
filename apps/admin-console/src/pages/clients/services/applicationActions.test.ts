import { applicationActionSchema } from '@odudu/contracts/admin';
import { APPLICATION_ACTIONS } from '#/entities/subject';
import { expect, it } from 'vitest';
import {
  ACTIONS_NEED_ME_READ,
  actionOptions,
  actionsBlock,
} from '#/pages/clients/services/applicationActions';

it('offers each action an application may start, in its own order, worded for the client', () => {
  const options = actionOptions(APPLICATION_ACTIONS);
  expect(options.map((option) => option.id)).toEqual(applicationActionSchema.options);
  expect(options.map((option) => option.label)).toEqual([
    'Verify the email address',
    'Choose a new password',
    'Set up an authenticator app',
    'Register a passkey',
    'Generate recovery codes',
    'Complete the profile',
  ]);
  expect(options.map((option) => option.id)).not.toContain('accept-terms');
  for (const option of options) {
    expect(option.description).not.toBe('');
    expect(option.unavailable).toBeNull();
  }
});

it('holds nothing back while no action is chosen, whatever scopes the client has', () => {
  expect(actionsBlock([], [])).toBeUndefined();
  expect(actionsBlock([], [{ name: 'openid' }])).toBeUndefined();
});

it('holds an action back until the client holds me:read, and names the scope', () => {
  expect(actionsBlock(['update-password'], [{ name: 'openid' }, { name: 'me:write' }])).toBe(
    ACTIONS_NEED_ME_READ,
  );
  expect(ACTIONS_NEED_ME_READ).toContain('me:read');
  expect(actionsBlock(['update-password'], [{ name: 'openid' }, { name: 'me:read' }])).toBe(
    undefined,
  );
});
