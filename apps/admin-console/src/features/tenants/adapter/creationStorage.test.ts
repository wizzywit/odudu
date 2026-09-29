import { afterEach, expect, it, vi } from 'vitest';
import { loadCreation, storeCreation } from '#/features/tenants/adapter/creationStorage.ts';
import type { Creation } from '#/features/tenants/service.ts';

const KEY = 'odudu.console.tenant-creation';
const HALFWAY: Creation = {
  step: 'administrator',
  tenant: 'acme',
  origin: 'created',
  username: 'grace',
  email: '',
  subjectId: 's1',
  granted: false,
};

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

it('keeps a creation in this tab, for the principal that began it and nobody else', () => {
  storeCreation('system/s0', HALFWAY, 'tenant');
  expect(localStorage.length).toBe(0);
  expect(loadCreation('system/s0', 'tenant')).toEqual(HALFWAY);
  expect(loadCreation('system/s9', 'tenant')).toBeNull();
  storeCreation('system/s0', null, 'tenant');
  expect(sessionStorage.getItem(KEY)).toBeNull();
});

it('keeps each flow apart, so one never opens the other', () => {
  const system: Creation = { ...HALFWAY, tenant: 'system' };
  storeCreation('system/s0', HALFWAY, 'tenant');
  storeCreation('system/s0', system, 'system-administrator');
  expect(loadCreation('system/s0', 'tenant')).toEqual(HALFWAY);
  expect(loadCreation('system/s0', 'system-administrator')).toEqual(system);
  storeCreation('system/s0', null, 'system-administrator');
  expect(loadCreation('system/s0', 'tenant')).toEqual(HALFWAY);
});

it('reads a stored value of the wrong shape, or not JSON, as no creation', () => {
  sessionStorage.setItem(KEY, '{"owner":"system/s0","creation":{"step":"flying"}}');
  expect(loadCreation('system/s0', 'tenant')).toBeNull();
  sessionStorage.setItem(KEY, 'not json');
  expect(loadCreation('system/s0', 'tenant')).toBeNull();
});

it('never keeps a field it does not know, a password least of all', () => {
  storeCreation('system/s0', { ...HALFWAY, password: 'once' } as Creation, 'tenant');
  expect(sessionStorage.getItem(KEY)).not.toContain('once');
});

it('survives storage that refuses every access, even at the getter', () => {
  vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
    throw new DOMException('denied', 'SecurityError');
  });
  expect(loadCreation('system/s0', 'tenant')).toBeNull();
  expect(() => {
    storeCreation('system/s0', HALFWAY, 'tenant');
  }).not.toThrow();
});
