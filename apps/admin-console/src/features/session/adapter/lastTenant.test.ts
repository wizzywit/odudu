import { afterEach, expect, it, vi } from 'vitest';
import { loadLastTenant, storeLastTenant } from '#/features/session/adapter/lastTenant.ts';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

it('remembers the last tenant signed in to, and nothing before that', () => {
  expect(loadLastTenant()).toBeNull();
  storeLastTenant('acme');
  expect(loadLastTenant()).toBe('acme');
  expect(sessionStorage.length).toBe(0);
});

it('ignores a stored value that is not a tenant name', () => {
  localStorage.setItem('odudu.console.tenant', '../admin');
  expect(loadLastTenant()).toBeNull();
});

it('survives storage that refuses every access, even at the getter', () => {
  vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
    throw new DOMException('denied', 'SecurityError');
  });
  expect(loadLastTenant()).toBeNull();
  expect(() => {
    storeLastTenant('acme');
  }).not.toThrow();
});

it('survives storage whose every call throws', () => {
  const refuse = (): never => {
    throw new DOMException('denied', 'QuotaExceededError');
  };
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(refuse);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(refuse);
  expect(loadLastTenant()).toBeNull();
  expect(() => {
    storeLastTenant('acme');
  }).not.toThrow();
});
