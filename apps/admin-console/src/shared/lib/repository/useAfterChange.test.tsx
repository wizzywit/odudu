import { QueryClientProvider, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it } from 'vitest';
import { createReadCache } from '#/shared/lib/repository/readCache';
import { useAfterChange, type ChangeReach } from '#/shared/lib/repository/useAfterChange';
import type { GatewayResult } from '#/shared/api/transport/gateway';

const done: GatewayResult<string> = { ok: true, status: 200, data: 'x', etag: null, next: null };
const refused: GatewayResult<string> = { ok: false, kind: 'defect' };

const reach: ChangeReach = {
  kinds: ['group'],
  records: ['groups/'],
  recordOf: (id) => `groups/${id}`,
  keys: [
    ['list', 'acme'],
    ['picker', 'acme', 'groups'],
  ],
  dropped: ['clients/'],
};

const SEEDED: readonly QueryKey[] = [
  ['group', 'acme', 'g1'],
  ['group', 'acme', 'g2'],
  ['record', 'acme', 'groups/g1'],
  ['record', 'acme', 'groups/g1/roles'],
  ['record', 'acme', 'groups/g2'],
  ['record', 'acme', 'roles/r1'],
  ['record', 'other', 'groups/g2'],
  ['list', 'acme', 'groups'],
  ['picker', 'acme', 'groups'],
  ['count', 'acme'],
  ['record', 'acme', 'clients/c1'],
];

function seeded() {
  const client = createReadCache();
  for (const key of SEEDED) client.setQueryData(key, 'held');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

function stale(client: QueryClient): string[] {
  return SEEDED.filter((key) => client.getQueryState(key)?.isInvalidated === true).map((key) =>
    key.join('/'),
  );
}

function held(client: QueryClient): string[] {
  return SEEDED.filter((key) => client.getQueryState(key) !== undefined).map((key) =>
    key.join('/'),
  );
}

it('reads again what the change can alter, and nothing of another tenant or kind', () => {
  const { client, wrapper } = seeded();
  const { result } = renderHook(() => useAfterChange('acme', null, reach), { wrapper });
  expect(result.current(done)).toBe(done);
  expect(stale(client)).toEqual([
    'group/acme/g1',
    'group/acme/g2',
    'record/acme/groups/g1',
    'record/acme/groups/g1/roles',
    'record/acme/groups/g2',
    'list/acme/groups',
    'picker/acme/groups',
  ]);
});

it('leaves a deleted record and everything under it to lapse', () => {
  const { client, wrapper } = seeded();
  const { result } = renderHook(() => useAfterChange('acme', 'g1', reach), { wrapper });
  result.current(done);
  expect(stale(client)).toEqual([
    'group/acme/g2',
    'record/acme/groups/g2',
    'list/acme/groups',
    'picker/acme/groups',
  ]);
});

it('drops, rather than marks stale, the records a deletion leaves behind', () => {
  const { client, wrapper } = seeded();
  const { result } = renderHook(() => useAfterChange('acme', 'g1', reach), { wrapper });
  result.current(done);
  expect(held(client)).not.toContain('record/acme/clients/c1');
  const { client: kept, wrapper: keptWrapper } = seeded();
  const { result: plain } = renderHook(() => useAfterChange('acme', null, reach), {
    wrapper: keptWrapper,
  });
  plain.current(done);
  expect(held(kept)).toContain('record/acme/clients/c1');
});

it('reads nothing again when the change was refused or lost', () => {
  const { client, wrapper } = seeded();
  const { result } = renderHook(() => useAfterChange('acme', null, reach), { wrapper });
  expect(result.current(refused)).toBe(refused);
  expect(stale(client)).toEqual([]);
  expect(held(client)).toHaveLength(SEEDED.length);
});
