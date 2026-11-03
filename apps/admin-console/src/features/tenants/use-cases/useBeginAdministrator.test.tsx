import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { draftOwner, SignedInContext } from '#/entities/session';
import { loadCreation, storeCreation } from '#/features/tenants/adapter/creationStorage';
import { administratorOf, flowOf } from '#/features/tenants/services/creation';
import { useBeginAdministrator } from '#/features/tenants/use-cases/useBeginAdministrator';

const go = vi.fn();

vi.mock('#/shared/repository/useGo', () => ({ useGo: () => go }));

const PRINCIPAL = { tenant: 'system', subjectId: 's0', username: 'root' };
const OWNER = draftOwner(PRINCIPAL);

function wrapper({ children }: { children: ReactNode }) {
  return (
    <SignedInContext value={{ principal: PRINCIPAL, ended: null }}>{children}</SignedInContext>
  );
}

afterEach(() => {
  go.mockClear();
  sessionStorage.clear();
});

function begin(tenant: string, origin: 'imported' | 'existing') {
  const { result } = renderHook(() => useBeginAdministrator(tenant, origin), { wrapper });
  result.current.start();
}

it('begins a tenant’s administrator afresh and goes to its step', () => {
  begin('acme', 'imported');
  expect(loadCreation(OWNER, flowOf('acme'))).toEqual(administratorOf('acme', 'imported'));
  expect(go).toHaveBeenCalledWith('/console/system/tenants/acme/new-administrator');
});

it('goes to the system administrators’ step for system', () => {
  begin('system', 'existing');
  expect(loadCreation(OWNER, flowOf('system'))).toEqual(administratorOf('system', 'existing'));
  expect(go).toHaveBeenCalledWith('/console/system/system-admins/new');
});

it('resumes one whose subject was already created, and replaces anything less', () => {
  const half = { ...administratorOf('acme', 'existing'), username: 'ada', subjectId: 's1' };
  storeCreation(OWNER, half, flowOf('acme'));
  begin('acme', 'imported');
  expect(loadCreation(OWNER, flowOf('acme'))).toEqual(half);

  const typed = { ...administratorOf('acme', 'existing'), username: 'grace' };
  storeCreation(OWNER, typed, flowOf('acme'));
  begin('acme', 'imported');
  expect(loadCreation(OWNER, flowOf('acme'))).toEqual(administratorOf('acme', 'imported'));
});

it('leaves another tenant’s draft alone', () => {
  const globex = { ...administratorOf('globex', 'existing'), username: 'ada', subjectId: 's9' };
  storeCreation(OWNER, globex, flowOf('globex'));
  begin('acme', 'existing');
  expect(loadCreation(OWNER, flowOf('globex'))).toEqual(globex);
});
