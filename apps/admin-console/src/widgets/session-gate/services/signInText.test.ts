import { describe, expect, it } from 'vitest';
import {
  continueAsLabel,
  enteredTenant,
  signInAgainLabel,
  signInLabel,
} from '#/widgets/session-gate/services/signInText';
import { type Principal } from '#/entities/session';

const grace: Principal = { tenant: 'acme', subjectId: 's1', username: 'grace' };

const ada: Principal = { tenant: 'acme', subjectId: 's2', username: 'ada' };

describe('the words of the sign-in pages', () => {
  it('labels the button by whether the visitor signs in or enters', () => {
    expect(signInLabel(false, 'acme')).toBe('Continue to sign-in');
    expect(signInLabel(false, '')).toBe('Continue to sign-in');
    expect(signInLabel(true, 'acme')).toBe('Enter acme');
    expect(signInLabel(true, '')).toBe('Enter tenant');
  });
});

describe('the labels of the session pages', () => {
  it('names the administrator each button acts for', () => {
    expect(signInAgainLabel(grace)).toBe('Sign in as grace again');
    expect(continueAsLabel(ada)).toBe('Continue as ada');
  });

  it('takes the tenant a visitor typed without the spaces around it', () => {
    expect(enteredTenant('  acme \n')).toBe('acme');
    expect(enteredTenant('')).toBe('');
  });
});
