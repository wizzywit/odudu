import { afterEach, expect, it, vi } from 'vitest';
import { writeThemeCookie } from '#/shared/api/adapter/themeCookie';

afterEach(() => {
  vi.restoreAllMocks();
  document.cookie = 'odudu-theme=; Path=/; Max-Age=0';
});

it('writes the choice as a cookie and clears it for the system', () => {
  writeThemeCookie('dark');
  expect(document.cookie).toContain('odudu-theme=dark');
  writeThemeCookie('light');
  expect(document.cookie).toContain('odudu-theme=light');
  writeThemeCookie('system');
  expect(document.cookie).not.toContain('odudu-theme');
});

it('marks the cookie Secure only on an https page', () => {
  const set = vi.spyOn(document, 'cookie', 'set');
  writeThemeCookie('dark');
  expect(set.mock.calls[0]?.[0]).not.toContain('Secure');
  vi.spyOn(window, 'location', 'get').mockReturnValue({ protocol: 'https:' } as Location);
  writeThemeCookie('dark');
  expect(set.mock.calls[1]?.[0]).toContain('; Secure');
});

it('survives a document that refuses cookies', () => {
  vi.spyOn(document, 'cookie', 'set').mockImplementation(() => {
    throw new DOMException('denied', 'SecurityError');
  });
  expect(() => {
    writeThemeCookie('dark');
  }).not.toThrow();
});
