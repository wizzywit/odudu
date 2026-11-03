import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  administratorOf,
  flowOf,
  storedCreation,
  useCreationProgress,
  type Creation,
} from '#/entities/creation-draft';
import { draftOwner, SignedInContext } from '#/entities/session';
import { useBeginAdministrator } from '#/features/begin-administrator';

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

function seed(tenant: string, creation: Creation) {
  const { result } = renderHook(() => useCreationProgress(OWNER, flowOf(tenant)), { wrapper });
  act(() => {
    result.current.update(creation);
  });
}

function begin(tenant: string, origin: 'imported' | 'existing') {
  const { result } = renderHook(() => useBeginAdministrator(tenant, origin), { wrapper });
  result.current.start();
}

it('begins a tenant’s administrator afresh and goes to its step', () => {
  begin('acme', 'imported');
  expect(storedCreation(OWNER, 'acme')).toEqual(administratorOf('acme', 'imported'));
  expect(go).toHaveBeenCalledWith('/console/system/tenants/acme/new-administrator');
});

it('goes to the system administrators’ step for system', () => {
  begin('system', 'existing');
  expect(storedCreation(OWNER, 'system')).toEqual(administratorOf('system', 'existing'));
  expect(go).toHaveBeenCalledWith('/console/system/system-admins/new');
});

it('resumes one whose subject was already created, and replaces anything less', () => {
  const half = { ...administratorOf('acme', 'existing'), username: 'ada', subjectId: 's1' };
  seed('acme', half);
  begin('acme', 'imported');
  expect(storedCreation(OWNER, 'acme')).toEqual(half);

  const typed = { ...administratorOf('acme', 'existing'), username: 'grace' };
  seed('acme', typed);
  begin('acme', 'imported');
  expect(storedCreation(OWNER, 'acme')).toEqual(administratorOf('acme', 'imported'));
});

it('leaves another tenant’s draft alone', () => {
  const globex = { ...administratorOf('globex', 'existing'), username: 'ada', subjectId: 's9' };
  seed('globex', globex);
  begin('acme', 'existing');
  expect(storedCreation(OWNER, 'globex')).toEqual(globex);
});
