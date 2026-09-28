import { afterEach, expect, it, vi } from 'vitest';
import { readRailCollapsed, rememberRailCollapsed } from '#/shared/repository/railChoice.ts';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

it('shows the rail until it is collapsed, and remembers the choice', () => {
  expect(readRailCollapsed()).toBe(false);
  rememberRailCollapsed(true);
  expect(localStorage.getItem('odudu.console.rail')).toBe('collapsed');
  expect(readRailCollapsed()).toBe(true);
  rememberRailCollapsed(false);
  expect(localStorage.getItem('odudu.console.rail')).toBeNull();
  expect(readRailCollapsed()).toBe(false);
});

it('ignores a stored value it does not recognise', () => {
  localStorage.setItem('odudu.console.rail', 'sideways');
  expect(readRailCollapsed()).toBe(false);
});

it('survives storage that refuses every access, even at the getter', () => {
  vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
    throw new DOMException('denied', 'SecurityError');
  });
  expect(readRailCollapsed()).toBe(false);
  expect(() => {
    rememberRailCollapsed(true);
  }).not.toThrow();
});

it('survives storage whose every call throws', () => {
  const refuse = (): never => {
    throw new DOMException('denied', 'QuotaExceededError');
  };
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(refuse);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(refuse);
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(refuse);
  expect(readRailCollapsed()).toBe(false);
  expect(() => {
    rememberRailCollapsed(true);
    rememberRailCollapsed(false);
  }).not.toThrow();
});
