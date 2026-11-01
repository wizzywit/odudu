import { expect, it } from 'vitest';
import { skipLogoutFixed } from '#/features/clients/service/blocks';
import {
  SECTIONS_LOGOUT,
  SKIP_LOGOUT_HINT,
  SKIP_LOGOUT_HINT_ON,
  skipLogoutHint,
  SKIP_LOGOUT_LABEL,
  SKIP_LOGOUT_WARNING,
} from '#/features/clients/service/logout';

it('warns in plain words that an ID token the application holds can sign its users out', () => {
  expect(SKIP_LOGOUT_WARNING).toBe(
    'When this is on, anyone who holds an ID token this application received, even an expired one, can sign its users out by opening a link while their session lasts, with no confirmation. Turn it on only for an application you run yourself whose ID tokens never reach a browser or a log.',
  );
});

it('labels the toggle and says what off means', () => {
  expect(SKIP_LOGOUT_LABEL).toBe('Skip the sign-out confirmation');
  expect(SKIP_LOGOUT_HINT).toBe('Off: the person is always asked to confirm sign-out.');
  expect(SECTIONS_LOGOUT.confirmation).toBe('Sign-out confirmation');
});

it('fixes the setting on the built-in admin client alone, and says it is on and why', () => {
  expect(skipLogoutFixed({ builtin_admin: true, client_id: 'odudu-admin' })).toMatch(
    /^odudu-admin always signs out at once and this cannot be changed\. This is the tenant's/u,
  );
  expect(skipLogoutFixed({ builtin_admin: false, client_id: 'billing' })).toBeNull();
});

it('says what on means beside the switch once it is on, and what off means otherwise', () => {
  expect(skipLogoutHint(null, false)).toBe(SKIP_LOGOUT_HINT);
  expect(skipLogoutHint(null, true)).toBe(SKIP_LOGOUT_HINT_ON);
  expect(SKIP_LOGOUT_HINT_ON).toBe(
    "On: signing out with this application's ID token ends the session without asking.",
  );
});

it('has no hint where the setting is fixed, whatever the value', () => {
  expect(skipLogoutHint('fixed', true)).toBeUndefined();
  expect(skipLogoutHint('fixed', false)).toBeUndefined();
});
