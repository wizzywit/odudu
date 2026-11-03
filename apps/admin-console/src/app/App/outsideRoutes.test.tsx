import { screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resetConsole } from '#/testing/resetConsole';
import { graceRoutes, renderConsoleAt } from '#/testing/renderConsole';

// Every panel a route can draw fails too, so a page error climbs past the
// root match: the router's own boundary or the console's root fallback is next.
vi.mock('#/widgets/failure/ui/RouteFailure', () => ({
  RouteFailure: () => {
    throw new Error('the route panel failed');
  },
}));
vi.mock('#/widgets/failure/ui/ShellFailure', () => ({
  ShellFailure: () => {
    throw new Error('the shell panel failed');
  },
}));
vi.mock('#/pages/subjects', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  SubjectsPage: () => {
    throw new Error('a page failed');
  },
}));

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubEnv('DEV', false);
});

afterEach(() => {
  resetConsole();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it('reaches the console root fallback, not the router default panel, past the root match', async () => {
  renderConsoleAt('/console/acme/subjects', graceRoutes(['view-users'], {}, {}));
  expect(await screen.findByRole('region', { name: 'error details' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Reload the console' })).toBeVisible();
  expect(screen.queryByRole('button', { name: /Show Error|Hide Error/u })).toBeNull();
  expect(screen.queryByText('Something went wrong!')).toBeNull();
});
