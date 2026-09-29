import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import type { RecordView } from '#/shared/service/record.ts';
import { Button } from '#/shared/view/Button.tsx';
import { RecordPage } from '#/shared/view/RecordPage.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

function view(overrides: Partial<RecordView> = {}): RecordView {
  return {
    status: 'ready',
    updated: false,
    refreshFailed: false,
    gone: false,
    acknowledge: vi.fn(),
    retry: vi.fn(),
    ...overrides,
  };
}

function page(record: RecordView, onTabChange = vi.fn(), tab = 'general') {
  return (
    <RecordPage
      record={record}
      kicker="acme · client"
      title="Billing portal"
      noun="client"
      actions={<Button variant="danger">Delete client</Button>}
      label="Client sections"
      tab={tab}
      onTabChange={onTabChange}
      tabs={[
        { id: 'general', label: 'General', dirty: true, panel: <p>General panel</p> },
        { id: 'activity', label: 'Activity', panel: <p>Activity panel</p> },
      ]}
    />
  );
}

it('heads the record with its name and shows the tab the address names', () => {
  render(page(view(), vi.fn(), 'activity'));
  expect(screen.getByRole('heading', { level: 1, name: 'Billing portal' })).toBeVisible();
  expect(screen.getByRole('tab', { name: 'Activity' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByText('Activity panel')).toBeVisible();
  expect(screen.getByRole('tab', { name: 'General, unsaved changes' })).toBeVisible();
});

it('asks for a tab change rather than making it', async () => {
  const user = userEvent.setup();
  const onTabChange = vi.fn();
  render(page(view(), onTabChange));
  await user.click(screen.getByRole('tab', { name: 'Activity' }));
  expect(onTabChange).toHaveBeenCalledWith('activity');
  expect(screen.getByRole('tab', { name: /General/u })).toHaveAttribute('aria-selected', 'true');
});

it('announces a record somebody else changed, until it is acknowledged', async () => {
  const user = userEvent.setup();
  const record = view();
  const { rerender } = render(page(record));
  const live = screen.getByRole('status', { name: 'Record changes' });
  expect(live).toBeEmptyDOMElement();
  const updated = view({ updated: true });
  rerender(page(updated));
  expect(live).toHaveTextContent('Updated since you opened it');
  await user.click(within(live).getByRole('button', { name: 'Dismiss' }));
  expect(updated.acknowledge).toHaveBeenCalledOnce();
});

it('keeps its tabs when a later read fails, and offers to check again', async () => {
  const user = userEvent.setup();
  const record = view({ refreshFailed: true });
  render(page(record));
  const live = screen.getByRole('status', { name: 'Record changes' });
  expect(live).toHaveTextContent(
    'Could not check this client for changes. What you see may be out of date; your edits are kept.',
  );
  expect(screen.getByRole('tablist', { name: 'Client sections' })).toBeVisible();
  await user.click(within(live).getByRole('button', { name: 'Check again' }));
  expect(record.retry).toHaveBeenCalledOnce();
});

it('keeps its tabs when a later read finds the record deleted', () => {
  render(page(view({ refreshFailed: true, gone: true })));
  expect(screen.getByRole('status', { name: 'Record changes' })).toHaveTextContent(
    'This client was deleted since you opened it. Your edits are still shown, but cannot be saved.',
  );
  expect(screen.getByText('General panel')).toBeVisible();
});

it('says it is loading, that the record is gone, or that it could not be read', async () => {
  const user = userEvent.setup();
  const { rerender } = render(page(view({ status: 'loading' })));
  expect(screen.getByRole('status', { name: '' })).toHaveTextContent('Loading client');
  expect(screen.queryByRole('tablist')).toBeNull();

  rerender(page(view({ status: 'missing' })));
  expect(screen.getByRole('heading', { name: 'No such client' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Delete client' })).toBeNull();

  const failed = view({ status: 'failed' });
  rerender(page(failed));
  expect(screen.getByRole('alert')).toHaveTextContent('This client could not be loaded');
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(failed.retry).toHaveBeenCalledOnce();
});

it('passes axe in both themes', async () => {
  expect(await axeInBothThemes(() => page(view({ updated: true })))).toEqual({
    light: [],
    dark: [],
  });
  expect(await axeInBothThemes(() => page(view({ status: 'missing' })))).toEqual({
    light: [],
    dark: [],
  });
});
