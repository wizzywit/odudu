import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RootFailure } from '#/widgets/failure/ui/RootFailure';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

const reload = vi.hoisted(() => vi.fn());

vi.mock('#/widgets/failure/adapter/browser', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  reloadPage: reload,
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function mount() {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubEnv('DEV', false);
  return render(<RootFailure error={new Error('secret')} route="/$tenant/clients" />);
}

it('draws with no provider above it, under the product name, with the route it was on', () => {
  mount();
  expect(screen.getByRole('main')).toHaveTextContent('odudu');
  expect(screen.getByRole('heading', { level: 1, name: 'Something went wrong' })).toHaveFocus();
  expect(screen.getByRole('region', { name: 'error details' })).toHaveTextContent(
    'Page: /$tenant/clients',
  );
  expect(document.body.textContent).not.toContain('secret');
});

it('offers a reload and nothing that needs the router', async () => {
  const user = userEvent.setup();
  mount();
  expect(screen.queryByRole('link')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Reload the console' }));
  expect(reload).toHaveBeenCalledOnce();
});

it('passes axe in both themes', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  expect(await axeInBothThemes(() => <RootFailure error={new Error('x')} route="/" />)).toEqual({
    light: [],
    dark: [],
  });
});
