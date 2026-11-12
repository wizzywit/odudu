import { requiredActionSchema } from '@odudu/contracts/admin';
import { REQUIRED_ACTIONS } from '#/entities/subject';
import { expect, it } from 'vitest';
import {
  ACTIONS_NEED_ME_READ,
  actionOptions,
  actionsBlock,
} from '#/pages/clients/services/applicationActions';

it('offers each required action the server knows, in its own order, worded for the client', () => {
  const options = actionOptions(REQUIRED_ACTIONS);
  expect(options.map((option) => option.id)).toEqual(requiredActionSchema.options);
  expect(options.map((option) => option.label)).toEqual([
    'Choose a new password',
    'Set up an authenticator app',
    'Register a passkey',
    'Generate recovery codes',
  ]);
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
