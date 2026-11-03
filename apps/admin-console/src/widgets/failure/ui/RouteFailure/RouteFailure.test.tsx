import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RouteFailure } from '#/widgets/failure/ui/RouteFailure';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { failingAt, routedWithProviders } from '#/testing/mountFailing';
import { resetConsole } from '#/testing/resetConsole';

afterEach(() => {
  resetConsole();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function failing(error: unknown = new Error('secret')) {
  return () => {
    throw error;
  };
}

it('names the template of the route that failed, never the address', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  render(failingAt('/acme/clients?q=ada', failing()));
  expect(await screen.findByRole('region', { name: 'error details' })).toHaveTextContent(
    'Page: /$tenant/clients',
  );
});

it('sends "Back to overview" to the tenant in the address', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  render(failingAt('/acme/clients', failing()));
  expect(await screen.findByRole('link', { name: 'Back to overview' })).toHaveAttribute(
    'href',
    '/console/acme',
  );
});

it('is quiet about the error in a production build, and says it in a development one', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubEnv('DEV', false);
  const first = render(failingAt('/acme/clients', failing()));
  await screen.findByRole('alert');
  expect(document.body.textContent).not.toContain('secret');
  first.unmount();
  vi.stubEnv('DEV', true);
  render(failingAt('/acme/clients', failing()));
  expect(await screen.findByText('secret')).toBeVisible();
});

it('calls the reset it is given', async () => {
  const user = userEvent.setup();
  const reset = vi.fn();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  render(routedWithProviders(() => <RouteFailure error={new Error('x')} reset={reset} />));
  await user.click(await screen.findByRole('button', { name: 'Try again' }));
  expect(reset).toHaveBeenCalledOnce();
});

it('passes axe in both themes', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  expect(
    await axeInBothThemes(
      () => failingAt('/acme/clients', failing()),
      () => screen.findByRole('alert'),
    ),
  ).toEqual({ light: [], dark: [] });
});
