import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useSubjectPicker } from '#/entities/subject/repository/useSubjectPicker';
import { hookHarness } from '#/testing/hookHarness';
import { json } from '#/testing/fakeTransport';
import { ADA, ADA_ID } from '#/testing/subjectsFixtures';

it("searches the given tenant's subjects by username", async () => {
  const { wrapper, sent } = hookHarness({
    'GET /console/api/admin/tenants/system/subjects': json({ items: [ADA] }),
  });
  const { result } = renderHook(() => useSubjectPicker('system'), { wrapper });
  await waitFor(() => {
    expect(result.current.options.map((s) => s.id)).toEqual([ADA_ID]);
  });
  act(() => {
    result.current.search('ad');
  });
  await waitFor(() => {
    expect(sent.map((request) => `${request.path}?${request.search.toString()}`)).toContain(
      '/console/api/admin/tenants/system/subjects?username=ad',
    );
  });
});
