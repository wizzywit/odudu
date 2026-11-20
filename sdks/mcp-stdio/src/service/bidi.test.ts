import { describe, expect, it } from 'vitest';
import { stripBidiControls } from '#/service/bidi';

describe('stripBidiControls', () => {
  it('removes the nine controls and keeps the marks', () => {
    const all = [0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]
      .map((codePoint) => String.fromCodePoint(codePoint))
      .join('');
    expect(stripBidiControls(`a${all}b‏c‎d؜e`)).toBe('ab‏c‎d؜e');
  });

  it('leaves plain text alone', () => {
    expect(stripBidiControls('Ada Lovelace مرحبا')).toBe('Ada Lovelace مرحبا');
  });
});
