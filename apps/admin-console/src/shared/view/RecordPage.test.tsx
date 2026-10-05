import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import type { RecordView } from '#/shared/service/record.ts';
import { Button } from '#/shared/view/Button';
import { TextField } from '#/shared/view/Field.tsx';
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
      breadcrumb={[
        { label: 'Applications' },
        { label: 'Clients', href: '/console/acme/clients' },
        { label: 'Billing portal' },
      ]}
      title="Billing portal"
      status={<span>enabled</span>}
      noun="client"
      actions={<Button>Open the audit trail</Button>}
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

it('leads with its breadcrumb in every state, and its status once it has one', () => {
  const { rerender } = render(page(view({ status: 'loading' })));
  const trail = () => screen.getByRole('navigation', { name: 'Breadcrumb' });
  expect(within(trail()).getByRole('link', { name: 'Clients' })).toBeVisible();
  expect(screen.queryByText('enabled')).toBeNull();
  rerender(page(view({ status: 'missing' })));
  expect(trail()).toBeVisible();
  rerender(page(view()));
  expect(within(trail()).getByText('Billing portal')).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('heading', { level: 1 }).parentElement).toHaveTextContent('enabled');
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
  expect(within(live).queryByRole('button')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Dismiss' }));
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
  expect(within(live).queryByRole('button')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Check again' }));
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
  const status = screen.getByRole('status', { name: '' });
  expect(status).toHaveTextContent('Loading client');
  expect(status.querySelector('[data-shape="record"]')).toHaveTextContent('GeneralActivity');
  expect(status.querySelector('[data-part="title"]')).toBeNull();
  expect(screen.queryByRole('tablist')).toBeNull();

  rerender(page(view({ status: 'missing' })));
  expect(screen.getByRole('heading', { name: 'No such client' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Open the audit trail' })).toBeNull();

  const failed = view({ status: 'failed' });
  rerender(page(failed));
  expect(screen.getByRole('alert')).toHaveTextContent('This client could not be loaded');
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(failed.retry).toHaveBeenCalledOnce();
});

it('says once what the caller cannot change, and shows every field in its tabs as text', () => {
  render(
    <RecordPage
      record={view()}
      breadcrumb={[{ label: 'Subjects', href: '/console/acme/subjects' }, { label: 'ada' }]}
      title="ada"
      noun="subject"
      label="Subject sections"
      tab="profile"
      onTabChange={vi.fn()}
      viewOnly={<p role="note">You can view subjects but not change them.</p>}
      tabs={[
        {
          id: 'profile',
          label: 'Profile',
          panel: <TextField label="Nickname" value="Countess" onChange={vi.fn()} />,
        },
      ]}
    />,
  );
  expect(screen.getByRole('note')).toHaveTextContent('You can view subjects but not change them.');
  expect(screen.queryByRole('textbox', { name: 'Nickname' })).toBeNull();
  expect(screen.getByText('Countess')).toBeVisible();
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
