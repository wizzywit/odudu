import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { CreateSpec } from '#/shared/lib/services/failure';
import type { GatewayFailure, GatewayResult } from '#/shared/api/transport/gateway';
import { useCreationFlow } from '#/shared/lib/use-cases/useCreationFlow';

type Field = 'name' | 'description';

const SPEC: CreateSpec = {
  noun: 'role',
  name: 'auditor',
  fields: ['name', 'description'],
  taken: { field: 'name', fallback: 'That name is taken' },
  capability: 'manage-tenant',
};

function ok<T>(data: T): GatewayResult<T> {
  return { ok: true, status: 201, data, etag: null, next: null };
}

const taken: GatewayFailure = {
  ok: false,
  kind: 'problem',
  problem: { type: 'about:blank', title: 'Conflict', status: 409 },
};
const forbidden: GatewayFailure = {
  ok: false,
  kind: 'problem',
  problem: { type: 'about:blank', title: 'Forbidden', status: 403 },
};
const lost: GatewayFailure = { ok: false, kind: 'network' };

function setup() {
  const report = vi.fn<(failure: GatewayFailure, needed: string) => boolean>(() => true);
  const hook = renderHook(() => useCreationFlow<Field>({ report }));
  return { hook, report };
}

async function submit(
  hook: ReturnType<typeof setup>['hook'],
  create: () => Promise<GatewayResult<string>>,
  options: { blocked?: boolean; problem?: { field: Field; text: string } | null } = {},
) {
  const made = vi.fn();
  await act(async () => {
    hook.result.current.submit({
      blocked: options.blocked ?? false,
      problem: options.problem ?? null,
      spec: SPEC,
      create,
      made,
    });
    await Promise.resolve();
  });
  return made;
}

it('sends the creation and hands what was made on, with nothing left said', async () => {
  const { hook } = setup();
  const create = vi.fn(() => Promise.resolve(ok('role')));
  const made = await submit(hook, create);
  expect(create).toHaveBeenCalledOnce();
  expect(made).toHaveBeenCalledWith('role');
  expect(hook.result.current.errors).toEqual({});
  expect(hook.result.current.message).toBeNull();
});

it('sends nothing while blocked, and says a field problem under its field', async () => {
  const { hook } = setup();
  const create = vi.fn(() => Promise.resolve(ok('role')));
  await submit(hook, create, { blocked: true });
  await submit(hook, create, { problem: { field: 'name', text: 'Enter a name.' } });
  expect(create).not.toHaveBeenCalled();
  expect(hook.result.current.errors).toEqual({ name: 'Enter a name.' });
});

it('places a name taken under its field and a refusal on the reporter', async () => {
  const { hook, report } = setup();
  const made = await submit(hook, () => Promise.resolve(taken));
  expect(made).not.toHaveBeenCalled();
  expect(hook.result.current.errors).toEqual({ name: 'That name is taken.' });
  expect(report).not.toHaveBeenCalled();
  await submit(hook, () => Promise.resolve(forbidden));
  expect(report).toHaveBeenCalledWith(forbidden, 'manage-tenant');
});

it('holds the next send after a lost answer, and says a send that threw as a defect', async () => {
  const { hook } = setup();
  await submit(hook, () => Promise.resolve(lost));
  expect(hook.result.current.unconfirmed).toBe(true);
  expect(hook.result.current.message).toMatch(/Could not confirm whether auditor was created/u);
  const create = vi.fn(() => Promise.resolve(ok('role')));
  await submit(hook, create);
  expect(create).not.toHaveBeenCalled();
  const other = setup();
  await submit(other.hook, () => Promise.reject(new Error('down')));
  expect(other.hook.result.current.message).toMatch(/fault in the console/u);
});

it('drops what was said of a field once it is edited, and of the rest at the next send', async () => {
  const { hook } = setup();
  await submit(hook, () => Promise.resolve(taken));
  act(() => {
    hook.result.current.edited('description');
  });
  expect(hook.result.current.errors).toEqual({ name: 'That name is taken.' });
  act(() => {
    hook.result.current.edited('name');
  });
  expect(hook.result.current.errors).toEqual({});
});

const LOOKED = { failed: 'Could not look.', missing: 'None found.' };

async function check(
  hook: ReturnType<typeof setup>['hook'],
  find: () => Promise<GatewayResult<string | null>>,
  busy = false,
) {
  const made = vi.fn();
  await act(async () => {
    hook.result.current.check({ busy, find, made, looked: LOOKED });
    await Promise.resolve();
  });
  return made;
}

it('carries on with what a lost answer made, once it is found', async () => {
  const { hook } = setup();
  await submit(hook, () => Promise.resolve(lost));
  const made = await check(hook, () => Promise.resolve(ok<string | null>('role')));
  expect(made).toHaveBeenCalledWith('role');
});

it('says nothing was found, and lets the creation go again', async () => {
  const { hook } = setup();
  await submit(hook, () => Promise.resolve(lost));
  await check(hook, () => Promise.resolve(ok<string | null>(null)));
  expect(hook.result.current.unconfirmed).toBe(false);
  expect(hook.result.current.message).toBe('None found.');
});

it('says a look that failed or threw could not be made, and looks for nothing while busy', async () => {
  const { hook } = setup();
  await check(hook, () => Promise.resolve(lost));
  expect(hook.result.current.message).toBe('Could not look.');
  await check(hook, () => Promise.resolve(ok<string | null>(null)));
  expect(hook.result.current.message).toBe('None found.');
  await check(hook, () => Promise.reject(new Error('down')));
  expect(hook.result.current.message).toBe('Could not look.');
  const find = vi.fn(() => Promise.resolve(ok<string | null>('role')));
  await check(hook, find, true);
  expect(find).not.toHaveBeenCalled();
});

it('reports a field problem without sending, through invalid and begin', () => {
  const { hook } = setup();
  act(() => {
    hook.result.current.invalid({ field: 'name', text: 'Enter a name.' });
  });
  expect(hook.result.current.errors).toEqual({ name: 'Enter a name.' });
  act(() => {
    hook.result.current.begin();
  });
  expect(hook.result.current.errors).toEqual({});
});
