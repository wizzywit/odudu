import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { BILLING, clientRoutes } from '#/testing/clientsFixtures';
import { json } from '#/testing/fakeTransport';
import { consoleAt, renderConsoleAt, whoami } from '#/testing/renderConsole';
import { EVERY_TENANT_CAPABILITY } from '#/testing/roleAnswers';
import { ADA_AT, ADA_ID, S, subject, subjectRoutes } from '#/testing/subjectsFixtures';
import { ACME_ADMIN } from '#/testing/tenantPaths';

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const ASSISTANT = `${ACME_ADMIN}/assistant`;
const STATUS = {
  enabled: true,
  slots: { fast: 'model-f', standard: 'model-s', deep: 'model-d' },
  modes: ['ask', 'act'],
  defaultMode: 'ask',
  modelChoices: ['model-s'],
  provider: { kind: 'anthropic' },
};

// The console as an administrator who may use the assistant, which is on.
const OFFERED = {
  [`GET ${ACME_ADMIN}/whoami`]: whoami(EVERY_TENANT_CAPABILITY, false, true),
  [`GET ${ASSISTANT}/status`]: json(STATUS),
  [`GET ${ASSISTANT}/last-conversation`]: json({ conversation: null }),
  [`GET ${ASSISTANT}/conversations`]: json({ items: [] }),
  [`POST ${ASSISTANT}/conversations`]: json(
    {
      id: 'c1',
      profile: 'review-client',
      mode: 'ask',
      title: null,
      created_at: '2026-11-27T08:00:00.000Z',
      last_active_at: '2026-11-27T08:00:00.000Z',
      archived: false,
      continuable: true,
      messages: [],
    },
    201,
  ),
};

const FIELD = { name: 'Message to the assistant' };

it('offers a person’s record the question of why they cannot sign in, and opens the panel with it ready', async () => {
  vi.stubGlobal('innerWidth', 1400);
  const user = userEvent.setup();
  renderConsoleAt(ADA_AT, subjectRoutes(EVERY_TENANT_CAPABILITY, OFFERED));
  await user.click(await screen.findByRole('button', { name: 'Why can’t they sign in?' }));

  const panel = await screen.findByRole('complementary', { name: 'Assistant panel' });
  await waitFor(() => {
    expect(within(panel).getByRole('textbox', FIELD)).toHaveValue('Why can’t this person sign in?');
  });
  expect(within(panel).getByText('Task')).toBeVisible();
  expect(
    within(panel).getByText('Why can’t this person sign in?', { selector: 'span' }),
  ).toBeVisible();
  expect(within(panel).getByText(`subject ${ADA_ID}`)).toBeVisible();
});

it('offers a service account no such question, since only a person signs in', async () => {
  const bot = subject(ADA_ID, null, { type: 'service' });
  renderConsoleAt(
    ADA_AT,
    subjectRoutes(EVERY_TENANT_CAPABILITY, { ...OFFERED, [`GET ${S}/${ADA_ID}`]: json(bot) }),
  );
  await screen.findByRole('heading', { level: 1, name: `service ${ADA_ID}` });
  expect(screen.queryByRole('button', { name: 'Why can’t they sign in?' })).toBeNull();
});

it('offers a client a review, and a message sent from it starts a review conversation about that client', async () => {
  vi.stubGlobal('innerWidth', 1400);
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    `/console/acme/clients/${BILLING.id}`,
    clientRoutes(EVERY_TENANT_CAPABILITY, OFFERED),
  );
  await user.click(await screen.findByRole('button', { name: 'Review with the assistant' }));
  const panel = await screen.findByRole('complementary', { name: 'Assistant panel' });
  const field = within(panel).getByRole('textbox', FIELD);
  await waitFor(() => {
    expect(field).toHaveValue('Review how this client is set up.');
  });
  await user.click(within(panel).getByRole('button', { name: 'Send' }));
  await waitFor(() => {
    expect(sent.some((request) => request.path === `${ASSISTANT}/conversations`)).toBe(true);
  });
  expect(sent.find((request) => request.path === `${ASSISTANT}/conversations`)?.body).toMatchObject(
    {
      profile: 'review-client',
      mode: 'ask',
      page_context: { objectType: 'client', objectId: BILLING.id },
    },
  );
});

it('draws no button, and asks nothing of the assistant, where the deployment has none', async () => {
  const view = renderConsoleAt(`/console/acme/clients/${BILLING.id}`, clientRoutes());
  await screen.findByRole('heading', { level: 1, name: 'Billing' });
  expect(screen.queryByRole('button', { name: 'Review with the assistant' })).toBeNull();
  expect(view.sent.filter((request) => request.path.includes('/assistant/'))).toEqual([]);
});

it('draws no button where the tenant has switched the assistant off', async () => {
  renderConsoleAt(`/console/acme/clients/${BILLING.id}`, {
    ...clientRoutes(EVERY_TENANT_CAPABILITY, OFFERED),
    [`GET ${ASSISTANT}/status`]: json({ enabled: false }),
  });
  await screen.findByRole('heading', { level: 1, name: 'Billing' });
  expect(screen.queryByRole('button', { name: 'Review with the assistant' })).toBeNull();
});

it('draws no button for a caller who may not use the assistant', async () => {
  const routes = clientRoutes(['manage-clients', 'view-users'], OFFERED);
  renderConsoleAt(`/console/acme/clients/${BILLING.id}`, {
    ...routes,
    [`GET ${ACME_ADMIN}/whoami`]: whoami(['manage-clients', 'view-users'], false, true),
  });
  await screen.findByRole('heading', { level: 1, name: 'Billing' });
  expect(screen.queryByRole('button', { name: 'Review with the assistant' })).toBeNull();
});

it('passes axe in both themes on a record that has the button', async () => {
  const found = await axeInBothThemes(
    () =>
      consoleAt(
        `/console/acme/clients/${BILLING.id}`,
        clientRoutes(EVERY_TENANT_CAPABILITY, OFFERED),
      ).element,
    () => screen.findByRole('button', { name: 'Review with the assistant' }),
  );
  expect(found).toEqual({ light: [], dark: [] });
});
