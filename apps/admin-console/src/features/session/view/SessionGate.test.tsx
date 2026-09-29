import { screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { json, offline, pending } from '#/testing/fakeTransport.ts';
import {
  consoleAt,
  GRACE,
  renderConsoleAt,
  whoami,
  resetConsole,
} from '#/testing/renderConsole.tsx';

afterEach(() => {
  resetConsole();
});

it('says it is reading the session until the gateway answers', async () => {
  renderConsoleAt('/console/acme', { 'GET /console/api/session': pending() });
  expect(await screen.findByRole('heading', { level: 1, name: 'Odudu console' })).toBeVisible();
  expect(screen.getByText('Reading your session')).toBeInTheDocument();
});

it('says the server could not be reached, and offers to try again', async () => {
  renderConsoleAt('/console/acme', { 'GET /console/api/session': offline() });
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The console could not reach the server',
  );
  expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
});

it('renders the page behind it once the session is read', async () => {
  renderConsoleAt('/console/acme', {
    'GET /console/api/session': json(GRACE),
    'GET /console/api/admin/tenants/acme/whoami': whoami([]),
  });
  expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
});

it('passes axe in both themes, loading and failed', async () => {
  const loading = () => consoleAt('/console/acme', { 'GET /console/api/session': pending() });
  expect(
    await axeInBothThemes(
      () => loading().element,
      () => screen.findByText('Reading your session'),
    ),
  ).toEqual({ light: [], dark: [] });
  const failed = () => consoleAt('/console/acme', { 'GET /console/api/session': offline() });
  expect(
    await axeInBothThemes(
      () => failed().element,
      () => screen.findByRole('alert'),
    ),
  ).toEqual({ light: [], dark: [] });
});
