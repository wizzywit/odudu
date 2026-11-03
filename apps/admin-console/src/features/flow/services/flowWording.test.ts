import { describe, expect, it } from 'vitest';
import { authenticatorText, flowArea } from '#/features/flow/services/flowWording';

describe('authenticatorText', () => {
  it('describes the four the server registers, and a stranger plainly', () => {
    expect(authenticatorText('password')).toMatch(/password/iu);
    expect(authenticatorText('recovery-code')).toMatch(/recovery/iu);
    expect(authenticatorText('sms')).toBe('An authenticator this console has no description of.');
  });
});

describe('flowArea', () => {
  it('names the page as the console’s rail names the area', () => {
    expect(flowArea().title).toBe('Sign-in flow');
    expect(flowArea().area.path).toBe('flow');
  });
});
