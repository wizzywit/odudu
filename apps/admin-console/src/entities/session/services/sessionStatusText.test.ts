import { describe, expect, it } from 'vitest';
import {
  backToLabel,
  continueAsLabel,
  signedInElsewhereWords,
  signInAgainLabel,
  signingInWords,
  signedInToTitle,
  signInToLabel,
  signingInText,
  signingInTitle,
} from '#/entities/session/services/sessionStatusText';

const grace = { tenant: 'acme', subjectId: 's1', username: 'grace' };
const ada = { tenant: 'acme', subjectId: 's2', username: 'ada' };

describe('the words of the session status pages', () => {
  it('titles the waiting page by whether a session ended', () => {
    expect(signingInTitle(false)).toBe('Signing in');
    expect(signingInTitle(true)).toBe('Your session ended');
  });

  it('says where the window is going, or that the console is opening', () => {
    expect(signingInText('acme')).toBe("Taking you to acme's sign-in…");
    expect(signingInText(null)).toBe('Opening the console…');
  });

  it('names the tenant each button acts for', () => {
    expect(signedInToTitle('acme')).toBe('Signed in to acme');
    expect(backToLabel('acme')).toBe('Back to acme');
    expect(signInToLabel('other')).toBe('Sign in to other');
  });

  it('names the administrator each session button acts for', () => {
    expect(signInAgainLabel(grace)).toBe('Sign in as grace again');
    expect(continueAsLabel(ada)).toBe('Continue as ada');
  });

  it('groups the words of the waiting page and of the signed-in-elsewhere page', () => {
    expect(signingInWords('acme', true)).toEqual({
      title: 'Your session ended',
      text: "Taking you to acme's sign-in…",
    });
    expect(signedInElsewhereWords('acme', 'globex')).toEqual({
      title: 'Signed in to acme',
      backLabel: 'Back to acme',
      backHref: '/console/acme',
      signInLabel: 'Sign in to globex',
    });
  });
});
