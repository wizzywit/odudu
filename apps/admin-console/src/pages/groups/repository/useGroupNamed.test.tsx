import { renderHook, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useGroupNamed } from '#/pages/groups/repository/useGroupRecord';
import { json } from '#/testing/fakeTransport';
import { hookHarness } from '#/testing/hookHarness';
import { ACME_ADMIN } from '#/testing/tenantPaths';

const G = `${ACME_ADMIN}/groups`;
const GROUP = {
  id: 'g1',
  name: 'eng',
  description: null,
  parent_id: null,
  default_for_new_subjects: false,
  path: '/eng',
  created_at: '2026-09-28T08:41:53.858Z',
  admin_reach: [],
  subtree_admin_reach: [],
  holds_default_group: false,
};

it('asks for nothing when no group is named', () => {
  const { wrapper, sent } = hookHarness({});
  const { result } = renderHook(() => useGroupNamed('acme', null), { wrapper });
  expect(result.current).toEqual({ status: 'none' });
  expect(sent).toHaveLength(0);
});

it('reads the group it is named, as loading and then ready', async () => {
  const { wrapper, sent } = hookHarness({ [`GET ${G}/g1`]: json(GROUP) });
  const { result } = renderHook(() => useGroupNamed('acme', 'g1'), { wrapper });
  expect(result.current.status).toBe('loading');
  await waitFor(() => {
    expect(result.current.status).toBe('ready');
  });
  expect(sent.map((s) => s.path)).toEqual([`${G}/g1`]);
});
