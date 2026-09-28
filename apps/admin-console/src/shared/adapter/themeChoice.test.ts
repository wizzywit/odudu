import { afterEach, expect, it, vi } from 'vitest';
import { loadThemeChoice, storeThemeChoice } from '#/shared/adapter/themeChoice.ts';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

it('stores a chosen theme and forgets it when the system is chosen', () => {
  expect(loadThemeChoice()).toBe('system');
  storeThemeChoice('dark');
  expect(localStorage.getItem('odudu.console.theme')).toBe('dark');
  expect(loadThemeChoice()).toBe('dark');
  storeThemeChoice('system');
  expect(localStorage.getItem('odudu.console.theme')).toBeNull();
});

it('reads a stored value it does not recognise as the system', () => {
  localStorage.setItem('odudu.console.theme', 'sepia');
  expect(loadThemeChoice()).toBe('system');
});

it('survives storage that refuses, at the getter or at every call', () => {
  const getter = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
    throw new DOMException('denied', 'SecurityError');
  });
  expect(loadThemeChoice()).toBe('system');
  expect(() => {
    storeThemeChoice('dark');
  }).not.toThrow();
  getter.mockRestore();
  const refuse = (): never => {
    throw new DOMException('denied', 'QuotaExceededError');
  };
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(refuse);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(refuse);
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(refuse);
  expect(loadThemeChoice()).toBe('system');
  expect(() => {
    storeThemeChoice('light');
    storeThemeChoice('system');
  }).not.toThrow();
});
