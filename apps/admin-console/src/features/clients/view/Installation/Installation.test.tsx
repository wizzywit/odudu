import { screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { C, clientRoutes } from '#/testing/clientsFixtures.ts';
import { json, problem } from '#/testing/fakeTransport.ts';
import { consoleAt, renderConsoleAt, resetConsole } from '#/testing/renderConsole.tsx';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = '/console/acme/clients/c-bill?tab=advanced';
const INSTALLATION = {
  issuer: 'https://id.example/acme',
  discovery_url: 'https://id.example/acme/.well-known/openid-configuration',
  client_id: 'billing',
  client_type: 'confidential',
  token_endpoint_auth_method: 'client_secret_basic',
  redirect_uris: ['https://billing.example/callback'],
  post_logout_redirect_uris: [],
  grant_types: ['authorization_code'],
  default_scope: 'openid profile',
};

function routes() {
  return clientRoutes(undefined, { [`GET ${C}/c-bill/installation`]: json(INSTALLATION) });
}

it('shows what an application is configured with, the issuer and client ID with a copy control', async () => {
  renderConsoleAt(AT, routes());
  const section = await screen.findByRole('region', { name: 'Installation' });
  expect(await within(section).findByText('https://id.example/acme')).toBeVisible();
  expect(within(section).getByRole('button', { name: 'Copy issuer' })).toBeVisible();
  expect(within(section).getByRole('button', { name: 'Copy discovery url' })).toBeVisible();
  expect(within(section).getByRole('button', { name: 'Copy client id' })).toBeVisible();
  expect(within(section).getByText('https://billing.example/callback')).toBeVisible();
  expect(within(section).getByText('openid profile')).toBeVisible();
  expect(within(section).getByText('None')).toBeVisible();
});

it('says it could not be loaded, and tries again on request', async () => {
  renderConsoleAt(
    AT,
    clientRoutes(undefined, {
      [`GET ${C}/c-bill/installation`]: problem(500, 'about:blank', 'Error'),
    }),
  );
  const section = await screen.findByRole('region', { name: 'Installation' });
  expect(await within(section).findByText('The installation could not be loaded.')).toBeVisible();
  expect(within(section).getByRole('button', { name: 'Try again' })).toBeVisible();
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, routes()).element,
      async () => {
        const section = await screen.findByRole('region', { name: 'Installation' });
        await within(section).findByText('https://id.example/acme');
      },
    ),
  ).toEqual({ light: [], dark: [] });
});
