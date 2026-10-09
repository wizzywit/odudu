import { afterEach, expect, it, vi } from 'vitest';
import { loadRailCollapsed, storeRailCollapsed } from '#/shared/adapter/railChoice.ts';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

it('shows the rail until it is collapsed, and remembers the choice', () => {
  expect(loadRailCollapsed()).toBe(false);
  storeRailCollapsed(true);
  expect(localStorage.getItem('odudu.console.rail')).toBe('collapsed');
  expect(loadRailCollapsed()).toBe(true);
  storeRailCollapsed(false);
  expect(localStorage.getItem('odudu.console.rail')).toBeNull();
  expect(loadRailCollapsed()).toBe(false);
});

it('ignores a stored value it does not recognise', () => {
  localStorage.setItem('odudu.console.rail', 'sideways');
  expect(loadRailCollapsed()).toBe(false);
});

it('survives storage that refuses every access, even at the getter', () => {
  vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
    throw new DOMException('denied', 'SecurityError');
  });
  expect(loadRailCollapsed()).toBe(false);
  expect(() => {
    storeRailCollapsed(true);
  }).not.toThrow();
});

it('survives storage whose every call throws', () => {
  const refuse = (): never => {
    throw new DOMException('denied', 'QuotaExceededError');
  };
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(refuse);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(refuse);
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(refuse);
  expect(loadRailCollapsed()).toBe(false);
  expect(() => {
    storeRailCollapsed(true);
    storeRailCollapsed(false);
  }).not.toThrow();
});
