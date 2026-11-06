import { describe, expect, it } from 'vitest';
import { checkDescription } from '#/service/description';
import { checkConsentText } from '#/service/scope-consent';

describe('text a column cannot hold', () => {
  it('refuses a NUL in a description and in a consent text, whatever is stored', () => {
    expect(checkDescription('a\u0000b').kind).toBe('invalid');
    expect(checkDescription('a\u0000b', 'a\u0000b').kind).toBe('invalid');
    expect(checkConsentText('a\u0000b').kind).toBe('invalid');
  });

  it('still takes null and ordinary text', () => {
    expect(checkDescription(null)).toEqual({ kind: 'ok', value: null });
    expect(checkDescription('plain')).toEqual({ kind: 'ok', value: 'plain' });
  });
});
