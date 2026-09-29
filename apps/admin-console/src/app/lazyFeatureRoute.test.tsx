import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Component, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { lazyFeatureRoute } from '#/app/lazyFeatureRoute.tsx';
import { useUnsavedGuard } from '#/shared/repository/useUnsavedGuard.ts';
import { TransportContext } from '#/shared/transport/useTransport.ts';
import { fakeTransport } from '#/testing/fakeTransport.ts';

afterEach(() => {
  useUnsavedGuard.getState().reset();
  vi.restoreAllMocks();
});

class Outer extends Component<{ children: ReactNode }, { error: string | null }> {
  override state: { error: string | null } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error: String(error) };
  }
  override render() {
    return this.state.error === null ? (
      this.props.children
    ) : (
      <p>{`outer caught ${this.state.error}`}</p>
    );
  }
}

function mount(element: ReactNode) {
  const fake = fakeTransport({});
  render(
    <TransportContext value={fake.transport}>
      <Outer>{element}</Outer>
    </TransportContext>,
  );
  return fake;
}

function Clients({ tenant }: { tenant: string }) {
  return <h1>{`Clients of ${tenant}`}</h1>;
}

it('shows its feature once the chunk arrives, and says it is loading until then', async () => {
  let arrive: (component: typeof Clients) => void = () => undefined;
  const Route = lazyFeatureRoute(
    () =>
      new Promise<typeof Clients>((resolve) => {
        arrive = resolve;
      }),
    'Loading clients',
  );
  mount(<Route tenant="acme" />);
  expect(await screen.findByRole('status')).toHaveTextContent('Loading clients');
  arrive(Clients);
  expect(await screen.findByRole('heading', { name: 'Clients of acme' })).toBeVisible();
});

it('offers a reload when the chunk cannot be fetched, without writing storage', async () => {
  const user = userEvent.setup();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const stored = vi.spyOn(Storage.prototype, 'setItem');
  const Route = lazyFeatureRoute<{ tenant: string }>(
    () => Promise.reject(new TypeError('Failed to fetch dynamically imported module')),
    'Loading clients',
  );
  const { leavePage } = mount(<Route tenant="acme" />);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'This part of the console could not be loaded',
  );
  expect(leavePage).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Reload the console' }));
  expect(leavePage).toHaveBeenCalledWith(window.location.href);
  expect(stored).not.toHaveBeenCalled();
});

it('asks the unsaved-changes guard before reloading over unsaved work', async () => {
  const user = userEvent.setup();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  useUnsavedGuard.getState().setDirty('acme/settings#sessions', 'Sessions');
  const Route = lazyFeatureRoute<{ tenant: string }>(
    () => Promise.reject(new TypeError('Failed to fetch dynamically imported module')),
    'Loading clients',
  );
  const { leavePage } = mount(<Route tenant="acme" />);
  await user.click(await screen.findByRole('button', { name: 'Reload the console' }));
  expect(leavePage).not.toHaveBeenCalled();
  expect(useUnsavedGuard.getState().pending).not.toBeNull();
  useUnsavedGuard.getState().leave();
  expect(leavePage).toHaveBeenCalledWith(window.location.href);
});

it("leaves a feature's own failure to the boundary above it", async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  function Broken(): ReactNode {
    throw new Error('the feature broke');
  }
  const Route = lazyFeatureRoute(() => Promise.resolve(Broken), 'Loading clients');
  mount(<Route />);
  expect(await screen.findByText('outer caught Error: the feature broke')).toBeVisible();
});
