import { describe, expect, it } from 'vitest';
import {
  backToLabel,
  signedInToTitle,
  signInToLabel,
  signingInText,
  signingInTitle,
} from '#/entities/session/services/sessionStatusText';

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
});
