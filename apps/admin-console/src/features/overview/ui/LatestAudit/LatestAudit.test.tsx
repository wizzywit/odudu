import type { AuditEvent } from '@odudu/contracts/admin';
import { render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { Gated } from '#/features/overview/services';
import { LatestAudit } from '#/features/overview/ui/LatestAudit';
import { auditEvent } from '#/testing/auditFixtures';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

const NOW = new Date('2026-09-28T14:03:22Z');

const EVENT = auditEvent();

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

it('tones each outcome as the audit trail does', () => {
  const audit: Gated<readonly AuditEvent[]> = {
    status: 'ready',
    data: [
      EVENT,
      { ...EVENT, id: 'a2', outcome: 'refused' },
      { ...EVENT, id: 'a3', outcome: 'failed' },
    ],
  };
  render(<LatestAudit audit={audit} href={HREF} now={NOW} />);
  const grid = screen.getByRole('grid', { name: 'Latest audit rows' });
  expect(within(grid).getByText('allowed')).toHaveAttribute('data-tone', 'active');
  expect(within(grid).getByText('refused')).toHaveAttribute('data-tone', 'warning');
  expect(within(grid).getByText('failed')).toHaveAttribute('data-tone', 'danger');
});

it("names each row's actor, and marks a caller from elsewhere", () => {
  const audit: Gated<readonly AuditEvent[]> = {
    status: 'ready',
    data: [
      { ...EVENT, actor_name: 'grace' },
      { ...EVENT, id: 'a3', actor_origin: 'other-tenant' },
    ],
  };
  render(<LatestAudit audit={audit} href={HREF} now={NOW} />);
  const [named, foreign] = within(screen.getByRole('grid', { name: 'Latest audit rows' }))
    .getAllByRole('row')
    .slice(1);
  expect(named).toHaveTextContent('grace');
  expect(foreign).toHaveTextContent("another tenant's caller");
  expect(foreign).toHaveTextContent('from elsewhere');
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

it('draws the table it will fill while it loads', () => {
  render(<LatestAudit audit={{ status: 'loading' }} href={HREF} now={NOW} />);
  const shape = screen.getByRole('status').querySelector('[data-shape="table"]');
  expect([...(shape?.querySelectorAll('th') ?? [])].map((th) => th.textContent)).toEqual([
    'When',
    'Action',
    'Outcome',
    'Actor',
  ]);
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
