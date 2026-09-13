import { describe, expect, it } from 'vitest';
import { parsePrompt } from '#/service/prompt';

function valuesOf(raw: string | undefined): string[] {
  const parsed = parsePrompt(raw);
  if (parsed.kind !== 'ok') throw new Error(`expected ${String(raw)} to parse`);
  return [...parsed.values].sort();
}

describe('parsePrompt', () => {
  it('reads an absent parameter as no values', () => {
    expect(valuesOf(undefined)).toEqual([]);
  });

  it.each(['', ' ', '   '])('reads %o as no values', (raw) => {
    expect(valuesOf(raw)).toEqual([]);
  });

  it.each(['none', 'login', 'consent', 'select_account'])('accepts %s on its own', (value) => {
    expect(valuesOf(value)).toEqual([value]);
  });

  it('accepts a space-delimited list of defined values', () => {
    expect(valuesOf('login consent')).toEqual(['consent', 'login']);
  });

  it('collapses a repeated value', () => {
    expect(valuesOf('login login')).toEqual(['login']);
  });

  it('tolerates extra separating spaces', () => {
    expect(valuesOf('login  consent')).toEqual(['consent', 'login']);
  });

  it.each(['none login', 'login none', 'none consent', 'none select_account'])(
    'refuses %s, which combines none with another value',
    (raw) => {
      expect(parsePrompt(raw).kind).toBe('invalid');
    },
  );

  it('refuses none combined with an undefined value', () => {
    expect(parsePrompt('none unheard_of').kind).toBe('invalid');
  });

  it.each(['unheard_of', 'login unheard_of'])('refuses %o', (raw) => {
    expect(parsePrompt(raw).kind).toBe('invalid');
  });

  // Case-sensitive: `Login` is not `login`, and guessing at the client's
  // intent is how a request asking for reauthentication gets silently
  // answered without it.
  it.each(['NONE', 'Login'])('refuses %s rather than case-folding it', (raw) => {
    expect(parsePrompt(raw).kind).toBe('invalid');
  });
});
