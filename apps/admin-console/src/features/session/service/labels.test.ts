import { describe, expect, it } from 'vitest';
import {
  backToLabel,
  continueAsLabel,
  enteredTenant,
  signedInToTitle,
  signInAgainLabel,
  signInLabel,
  signInToLabel,
  signingInText,
  signingInTitle,
} from '#/features/session/service/labels.ts';
import { type Principal } from '#/features/session/service/address.ts';

const grace: Principal = { tenant: 'acme', subjectId: 's1', username: 'grace' };

const ada: Principal = { tenant: 'acme', subjectId: 's2', username: 'ada' };

describe('the words of the sign-in pages', () => {
  it('labels the button by whether the visitor signs in or enters', () => {
    expect(signInLabel(false, 'acme')).toBe('Continue to sign-in');
    expect(signInLabel(false, '')).toBe('Continue to sign-in');
    expect(signInLabel(true, 'acme')).toBe('Enter acme');
    expect(signInLabel(true, '')).toBe('Enter tenant');
  });

  it('titles the waiting page by whether a session ended', () => {
    expect(signingInTitle(false)).toBe('Signing in');
    expect(signingInTitle(true)).toBe('Your session ended');
  });

  it('says where the window is going, or that the console is opening', () => {
    expect(signingInText('acme')).toBe("Taking you to acme's sign-in…");
    expect(signingInText(null)).toBe('Opening the console…');
  });
});

describe('the labels of the session pages', () => {
  it('names the tenant or administrator each button acts for', () => {
    expect(signInAgainLabel(grace)).toBe('Sign in as grace again');
    expect(continueAsLabel(ada)).toBe('Continue as ada');
    expect(signedInToTitle('acme')).toBe('Signed in to acme');
    expect(backToLabel('acme')).toBe('Back to acme');
    expect(signInToLabel('other')).toBe('Sign in to other');
  });

  it('takes the tenant a visitor typed without the spaces around it', () => {
    expect(enteredTenant('  acme \n')).toBe('acme');
    expect(enteredTenant('')).toBe('');
  });
});
