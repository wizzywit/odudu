import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SignedInContext } from '#/entities/session';
import { useExportEvents } from '#/pages/audit/use-cases/useExportEvents';
import { useToasts } from '#/shared/lib/repository/useToasts';
import { AUDIT } from '#/testing/auditFixtures';
import { fakeTransport, pending, problem, type Answer } from '#/testing/fakeTransport';
import { hookHarness } from '#/testing/hookHarness';
import { whoami } from '#/testing/renderConsole';
import { ACME_ADMIN } from '#/testing/tenantPaths';

const GRACE = { tenant: 'acme', subjectId: 's1', username: 'grace' };
const saved: string[] = [];

beforeEach(() => {
  saved.length = 0;
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }),
  );
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    saved.push(this.download);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  useToasts.setState({ toasts: [], nextId: 1 });
});

const NDJSON: Answer = () =>
  new Response('{"id":"e3"}\n{"id":"e2"}\n', {
    headers: { 'content-type': 'application/x-ndjson' },
  });

function exporting(
  answer: Answer,
  transport?: ReturnType<typeof fakeTransport>['transport'],
  filters: Record<string, string> = {},
) {
  const harness = hookHarness(
    {
      [`GET ${ACME_ADMIN}/whoami`]: whoami(['view-audit']),
      [`GET ${AUDIT}/export`]: answer,
    },
    transport,
  );
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SignedInContext value={{ principal: GRACE, ended: null }}>
      <harness.wrapper>{children}</harness.wrapper>
    </SignedInContext>
  );
  const view = renderHook(() => useExportEvents('acme', filters), { wrapper });
  return { ...view, sent: harness.sent };
}

it('is busy while the export is read, and not before', async () => {
  const { result } = exporting(pending());
  expect(result.current.busy).toBe(false);
  act(() => {
    result.current.start();
  });
  await waitFor(() => {
    expect(result.current.busy).toBe(true);
  });
  expect(result.current.message).toBeNull();
});

it('names the file saved and how many events it holds, asking for the filters applied', async () => {
  const { result, sent } = exporting(NDJSON, undefined, { outcome: 'refused' });
  act(() => {
    result.current.start();
  });
  const today = new Date().toISOString().slice(0, 10);
  const line = `Saved acme-audit-${today}.ndjson, 2 events.`;
  await waitFor(() => {
    expect(result.current.message).toBe(line);
  });
  expect(saved).toEqual([`acme-audit-${today}.ndjson`]);
  expect(useToasts.getState().toasts.map((toast) => toast.message)).toContain(line);
  expect(sent.find((each) => each.path === `${AUDIT}/export`)?.search.toString()).toBe(
    'outcome=refused',
  );
});

it('says an export larger than the API holds, and saves nothing', async () => {
  const { result } = exporting(problem(413, 'about:blank#export-too-large', 'Content Too Large'));
  act(() => {
    result.current.start();
  });
  await waitFor(() => {
    expect(result.current.message).toMatch(/Narrow the filters and export again/u);
  });
  expect(saved).toEqual([]);
});

it('names view-audit when the export is refused', async () => {
  const { result } = exporting(problem(403));
  act(() => {
    result.current.start();
  });
  await waitFor(() => {
    expect(result.current.message).toBe('Exporting the trail needs view-audit.');
  });
});

it('says the export could not be read when the read itself throws', async () => {
  const { transport } = fakeTransport({});
  const { result } = exporting(NDJSON, {
    ...transport,
    gateway: { ...transport.gateway, download: () => Promise.reject(new Error('the read threw')) },
  });
  act(() => {
    result.current.start();
  });
  await waitFor(() => {
    expect(result.current.message).toBe(
      'The export could not be read. Nothing was saved; try again.',
    );
  });
  expect(saved).toEqual([]);
});
