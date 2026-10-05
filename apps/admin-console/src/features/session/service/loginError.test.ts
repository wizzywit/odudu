import { describe, expect, it } from 'vitest';
import {
  loginErrorMessage,
  loginNotice,
  SIGN_OUT_FAILED,
  switchFailedText,
} from '#/features/session/service/loginError.ts';

describe('loginErrorMessage', () => {
  it('says in words why a tenant sign-in came back without a session', () => {
    expect(loginErrorMessage('access_denied')).toBe('Sign-in was cancelled.');
    expect(loginErrorMessage('temporarily_unavailable')).toBe(
      "The tenant's sign-in is unavailable just now. Try again shortly.",
    );
    expect(loginErrorMessage('server_error')).toBe(
      "The tenant's sign-in failed on its side. Try again.",
    );
    expect(loginErrorMessage('login_required')).toBe(
      'The tenant needs you to finish signing in on its own page. Try again.',
    );
    expect(loginErrorMessage('invalid_scope')).toBe(
      "The tenant refused the console's sign-in request. Try again, and tell the tenant's operator if it keeps happening.",
    );
  });

  it('answers any code it does not know, or a name that is no code, with a general message', () => {
    expect(loginErrorMessage('made_up')).toBe('Sign-in did not complete. Try again.');
    expect(loginErrorMessage('<script>')).toBe('Sign-in did not complete. Try again.');
  });
});

describe('the words about a sign-in that came back without a session', () => {
  it('is nothing when no error came back, and the code in words otherwise', () => {
    expect(loginNotice(null)).toBeNull();
    expect(loginNotice('access_denied')).toBe('Sign-in was cancelled.');
    expect(loginNotice('made_up')).toBe('Sign-in did not complete. Try again.');
  });

  it('says what happened to a switch that left the old session standing', () => {
    expect(switchFailedText('Sign-in was cancelled.', 'acme')).toBe(
      "The switch to another tenant did not complete: Sign-in was cancelled. You're still signed in to acme.",
    );
  });

  it('says a sign-out did not finish', () => {
    expect(SIGN_OUT_FAILED).toBe('Could not sign out. Try again.');
  });
});
