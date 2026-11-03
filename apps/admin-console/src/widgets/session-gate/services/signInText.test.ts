import { describe, expect, it } from 'vitest';
import { enteredTenant, signInLabel } from '#/widgets/session-gate/services/signInText';
describe('the words of the sign-in pages', () => {
  it('labels the button by whether the visitor signs in or enters', () => {
    expect(signInLabel(false, 'acme')).toBe('Continue to sign-in');
    expect(signInLabel(false, '')).toBe('Continue to sign-in');
    expect(signInLabel(true, 'acme')).toBe('Enter acme');
    expect(signInLabel(true, '')).toBe('Enter tenant');
  });
});

describe('the tenant a visitor types', () => {
  it('takes the tenant a visitor typed without the spaces around it', () => {
    expect(enteredTenant('  acme \n')).toBe('acme');
    expect(enteredTenant('')).toBe('');
  });
});
