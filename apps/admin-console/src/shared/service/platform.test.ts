import { describe, expect, it } from 'vitest';
import { keyLabel, platformOf } from '#/shared/service/platform.ts';

describe('the platform', () => {
  it('prefers the user-agent data, and falls back to navigator.platform', () => {
    expect(platformOf({ userAgentData: { platform: 'macOS' }, platform: 'Win32' })).toBe('mac');
    expect(platformOf({ platform: 'MacIntel' })).toBe('mac');
    expect(platformOf({ platform: 'iPhone' })).toBe('mac');
    expect(platformOf({ userAgentData: { platform: 'Windows' }, platform: 'MacIntel' })).toBe(
      'other',
    );
    expect(platformOf({ platform: 'Linux x86_64' })).toBe('other');
    expect(platformOf(undefined)).toBe('other');
  });
});

describe('a key, as each platform names it', () => {
  it('is Return on a Mac and Enter elsewhere', () => {
    expect(keyLabel('Enter', 'mac')).toEqual({ shown: '↩ Return', spoken: 'Return' });
    expect(keyLabel('Enter', 'other')).toEqual({ shown: '↵ Enter', spoken: 'Enter' });
  });

  it('draws the modifiers as a Mac does, and spells them out elsewhere', () => {
    expect(keyLabel('Mod', 'mac')).toEqual({ shown: '⌘', spoken: 'Command' });
    expect(keyLabel('Mod', 'other')).toEqual({ shown: 'Ctrl', spoken: 'Ctrl' });
    expect(keyLabel('Alt', 'mac')).toEqual({ shown: '⌥', spoken: 'Option' });
    expect(keyLabel('Alt', 'other')).toEqual({ shown: 'Alt', spoken: 'Alt' });
  });

  it('leaves a character key as it is', () => {
    expect(keyLabel('[', 'mac')).toEqual({ shown: '[', spoken: '[' });
  });
});
