import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useSaveGroups } from '#/entities/subject/repository/useSubjectAccess';
import { json } from '#/testing/fakeTransport';
import { hookHarness } from '#/testing/hookHarness';
import { useTransport } from '#/shared/transport/useTransport';
import { ACME_ADMIN } from '#/testing/tenantPaths';

const PATH = `PUT ${ACME_ADMIN}/subjects/s1/groups`;

it("reads again what a subject's groups change, and nothing of another subject's", async () => {
  const { wrapper, queryClient } = hookHarness({
    [PATH]: json({ items: [] }, 200, { etag: '"g2"' }),
  });
  const held = [
    ['memberships', 'acme', 's1'],
    ['held-capabilities', 'acme', 's1'],
    ['holders', 'acme', 'enabled', 'any'],
    ['list', 'acme', 'subjects'],
    ['memberships', 'acme', 's2'],
    ['held-capabilities', 'acme', 's2'],
    ['list', 'other', 'subjects'],
  ];
  for (const key of held) queryClient.setQueryData(key, 'held');
  const { result } = renderHook(
    () => {
      const { gateway } = useTransport();
      return { gateway, save: useSaveGroups('acme', 's1') };
    },
    { wrapper },
  );
  await act(async () => {
    await result.current.save(result.current.gateway, {
      values: { group_ids: [] },
      changes: { group_ids: [] },
      ifMatch: '"g1"',
    });
  });
  expect(held.map((key) => queryClient.getQueryState(key)?.isInvalidated)).toEqual([
    true,
    true,
    true,
    true,
    false,
    false,
    false,
  ]);
});
