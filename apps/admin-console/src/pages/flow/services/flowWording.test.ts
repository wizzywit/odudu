import { describe, expect, it } from 'vitest';
import { authenticatorText, flowArea, flowPage } from '#/pages/flow/services/flowWording';

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

describe('flowPage', () => {
  it('carries the area, its title and the page’s words', () => {
    const { title, words } = flowPage();
    expect(title).toBe('Sign-in flow');
    expect(words.steps.noticeTitle).toBe('Sign-in flow');
    expect(words.steps.up).toBe('Up');
    expect(words.otp.title).toBe('One-time password');
    expect(words.steps.requirements.map((option) => option.id)).toEqual([
      'required',
      'alternative',
      'conditional',
      'disabled',
    ]);
  });
});
