import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { useRecordTab } from '#/shared/repository/useRecordTab';
import { Tabs } from '#/shared/ui/Tabs';
import { mountAtRoute } from '#/testing/mountAtRoute';

function Client() {
  const { tab, selectTab } = useRecordTab(['general', 'tokens'] as const);
  return (
    <Tabs
      label="Client"
      selectedKey={tab}
      onSelectionChange={(id) => {
        if (id === 'general' || id === 'tokens') selectTab(id);
      }}
      tabs={[
        { id: 'general', label: 'General', panel: <p>General panel</p> },
        { id: 'tokens', label: 'Tokens', panel: <p>Tokens panel</p> },
      ]}
    />
  );
}

function mount(url: string) {
  return mountAtRoute(url, '/clients/c1', Client).router;
}

it("keeps the chosen tab in the URL, and leaves the last tab's list behind", async () => {
  const user = userEvent.setup();
  const router = mount('/clients/c1?q=x&after=b2Zmc2V0LTE.dGFnMQ');
  expect(await screen.findByText('General panel')).toBeVisible();
  await user.click(screen.getByRole('tab', { name: 'Tokens' }));
  expect(await screen.findByText('Tokens panel')).toBeVisible();
  expect(router.state.location.href).toBe('/clients/c1?tab=tokens');
});

it("keeps a tab's list when its own tab is chosen again", async () => {
  const user = userEvent.setup();
  const router = mount('/clients/c1?q=x&after=b2Zmc2V0LTE.dGFnMQ');
  expect(await screen.findByText('General panel')).toBeVisible();
  const before = router.state.location.href;
  await user.click(screen.getByRole('tab', { name: 'General' }));
  expect(router.state.location.href).toBe(before);
});

it('opens on the tab the URL names', async () => {
  mount('/clients/c1?tab=tokens');
  expect(await screen.findByText('Tokens panel')).toBeVisible();
});

it('falls back to the first tab for a name the record does not have', async () => {
  mount('/clients/c1?tab=nonsense');
  expect(await screen.findByText('General panel')).toBeVisible();
});
