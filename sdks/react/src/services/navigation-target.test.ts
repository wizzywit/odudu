import { describe, expect, it } from 'vitest';
import { safeNavigationTarget } from '#/services/navigation-target';

const BASE = 'http://app.test/page';

describe('safeNavigationTarget', () => {
  it('accepts http and https addresses and same-origin paths', () => {
    expect(safeNavigationTarget('https://issuer.example/logout?x=1', BASE)).toBe(
      'https://issuer.example/logout?x=1',
    );
    expect(safeNavigationTarget('http://127.0.0.1:3000/authorize', BASE)).toBeDefined();
    expect(safeNavigationTarget('/bff/login', BASE)).toBe('/bff/login');
  });

  it('refuses every other scheme, however it is written', () => {
    for (const target of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'java\tscript:alert(1)',
      'java\nscript:alert(1)',
      ' javascript:alert(1)',
      'data:text/html,<b>x</b>',
      'blob:https://app.test/1',
      'vbscript:x',
      'file:///etc/passwd',
    ]) {
      expect(safeNavigationTarget(target, BASE), target).toBeUndefined();
    }
  });

  it('accepts a protocol-relative address, which resolves to the page scheme', () => {
    expect(safeNavigationTarget('//other.example/x', BASE)).toBe('//other.example/x');
  });

  it('refuses what cannot be parsed', () => {
    expect(safeNavigationTarget('http://', BASE)).toBeUndefined();
  });
});
