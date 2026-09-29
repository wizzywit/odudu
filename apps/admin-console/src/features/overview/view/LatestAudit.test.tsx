import type { AuditEvent } from '@odudu/contracts/admin';
import { render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { Gated } from '#/features/overview/service.ts';
import { LatestAudit } from '#/features/overview/view/LatestAudit.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

const NOW = new Date('2026-09-28T14:03:22Z');

const EVENT: AuditEvent = {
  id: 'a1',
  occurred_at: '2026-09-28T13:41:05Z',
  event_type: 'admin_mutation',
  action: 'client.update',
  outcome: 'allowed',
  actor_tenant_id: 't1',
  actor_subject_id: '0192f7a4-5c1e-7b3a-9d2e-6f8a1b2c3d4e',
  actor_client_id: null,
  resource_type: 'client',
  resource_id: 'c1',
  request_id: 'req-7f3a9c',
  ip: '203.0.113.9',
  detail: {},
};

const READY: Gated<readonly AuditEvent[]> = {
  status: 'ready',
  data: [EVENT, { ...EVENT, id: 'a2', action: 'key.promote', outcome: 'refused' }],
};

const HREF = '/console/acme/audit';

it('lists the latest rows, and links the whole trail', () => {
  render(<LatestAudit audit={READY} href={HREF} now={NOW} />);
  const rows = within(screen.getByRole('grid', { name: 'Latest audit rows' }))
    .getAllByRole('row')
    .slice(1);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent('client.update');
  expect(rows[1]).toHaveTextContent('refused');
  expect(screen.getByRole('link', { name: 'Open the audit trail' })).toHaveAttribute('href', HREF);
});

it('names view-audit and offers no link when the trail is not readable', () => {
  render(
    <LatestAudit audit={{ status: 'needs', capability: 'view-audit' }} href={HREF} now={NOW} />,
  );
  expect(screen.getByRole('note')).toHaveTextContent(
    'The audit trail needs the view-audit capability.',
  );
  expect(screen.queryByRole('link')).toBeNull();
  expect(screen.queryByRole('grid')).toBeNull();
});

it('says when nothing is recorded yet', () => {
  render(<LatestAudit audit={{ status: 'ready', data: [] }} href={HREF} now={NOW} />);
  expect(screen.getByRole('heading', { name: 'Nothing recorded yet' })).toBeVisible();
});

it('passes axe in both themes', async () => {
  for (const audit of [
    READY,
    { status: 'needs', capability: 'view-audit' },
    { status: 'loading' },
    { status: 'failed', refused: false, retry: vi.fn() },
  ] as const) {
    expect(
      await axeInBothThemes(() => <LatestAudit audit={audit} href={HREF} now={NOW} />),
    ).toEqual({ light: [], dark: [] });
  }
});
