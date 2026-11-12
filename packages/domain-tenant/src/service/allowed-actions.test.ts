import { describe, expect, it } from 'vitest';
import {
  ALLOWED_ACTION_NAMES,
  ALLOWED_ACTIONS_NEED_ME_READ,
  ALLOWED_ACTIONS_KEEP_ME_READ_MESSAGE,
  ALLOWED_ACTIONS_NEED_ME_READ_MESSAGE,
  allowedActionsHaveMeRead,
  distinctAllowedActions,
  unknownAllowedActions,
} from '#/service/allowed-actions';

describe('the actions a client may start', () => {
  it('are the four required actions the server already has', () => {
    expect([...ALLOWED_ACTION_NAMES]).toEqual([
      'update-password',
      'configure-totp',
      'configure-passkey',
      'generate-recovery-codes',
    ]);
  });

  it('name any entry outside that vocabulary, in the order given', () => {
    expect(unknownAllowedActions([])).toEqual([]);
    expect(unknownAllowedActions(['update-password', 'configure-totp'])).toEqual([]);
    expect(unknownAllowedActions(['delete-account', 'update-password', 'Configure-TOTP'])).toEqual([
      'delete-account',
      'Configure-TOTP',
    ]);
  });

  it('drop a repeated entry and keep the first of each', () => {
    expect(distinctAllowedActions(['configure-totp', 'update-password', 'configure-totp'])).toEqual(
      ['configure-totp', 'update-password'],
    );
  });
});

describe('allowedActionsHaveMeRead', () => {
  it('holds when the client may start nothing, whatever it holds', () => {
    expect(allowedActionsHaveMeRead([], [])).toBe(true);
    expect(allowedActionsHaveMeRead([], ['openid'])).toBe(true);
  });

  it('holds only when me:read is among the scopes of a client with an action', () => {
    expect(allowedActionsHaveMeRead(['update-password'], ['openid', 'me:read'])).toBe(true);
    expect(allowedActionsHaveMeRead(['update-password'], ['openid', 'me:write'])).toBe(false);
    expect(allowedActionsHaveMeRead(['update-password'], [])).toBe(false);
  });

  it('has a stable code and a message that names the scope', () => {
    expect(ALLOWED_ACTIONS_NEED_ME_READ).toBe('allowed_actions_need_me_read');
    expect(ALLOWED_ACTIONS_NEED_ME_READ_MESSAGE).toContain('me:read');
  });

  it('tells a person removing me:read to clear the actions, not to assign it', () => {
    expect(ALLOWED_ACTIONS_KEEP_ME_READ_MESSAGE).toContain('me:read');
    expect(ALLOWED_ACTIONS_KEEP_ME_READ_MESSAGE).toContain('clear');
    expect(ALLOWED_ACTIONS_KEEP_ME_READ_MESSAGE).not.toContain('assign');
  });
});
