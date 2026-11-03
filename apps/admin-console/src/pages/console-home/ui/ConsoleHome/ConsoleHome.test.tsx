import { screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { json, SESSION_ENDED } from '#/testing/fakeTransport';
import { resetConsole } from '#/testing/resetConsole';
import { consoleAt, GRACE, renderConsoleAt, whoami } from '#/testing/renderConsole';
import { ACME_ADMIN } from '#/testing/tenantPaths';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  resetConsole();
});

const QUESTION = { name: 'Which tenant do you administer?' };

it('asks which tenant when nobody is signed in', async () => {
  renderConsoleAt('/console/', { 'GET /console/api/session': SESSION_ENDED });
  expect(await screen.findByRole('textbox', QUESTION)).toBeVisible();
});

it('asks a tenant administrator first before another tenant named by ?tenant=', async () => {
  renderConsoleAt('/console/?tenant=globex', {
    'GET /console/api/session': json(GRACE),
    [`GET ${ACME_ADMIN}/whoami`]: whoami([]),
  });
  expect(await screen.findByRole('heading', { level: 1, name: 'Signed in to acme' })).toBeVisible();
});

it('passes axe in both themes, asking and asking first', async () => {
  const asking = () => consoleAt('/console/', { 'GET /console/api/session': SESSION_ENDED });
  expect(
    await axeInBothThemes(
      () => asking().element,
      () => screen.findByRole('textbox', QUESTION),
    ),
  ).toEqual({ light: [], dark: [] });
  const elsewhere = () =>
    consoleAt('/console/?tenant=globex', { 'GET /console/api/session': json(GRACE) });
  expect(
    await axeInBothThemes(
      () => elsewhere().element,
      () => screen.findByRole('heading', { level: 1, name: 'Signed in to acme' }),
    ),
  ).toEqual({ light: [], dark: [] });
});
