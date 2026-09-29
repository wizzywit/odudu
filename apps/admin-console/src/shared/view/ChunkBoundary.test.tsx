import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Component, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { ChunkLoadError } from '#/shared/service/chunkLoad.ts';
import { ChunkBoundary, ChunkFailed } from '#/shared/view/ChunkBoundary.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

function Throws({ error }: { error: Error }): ReactNode {
  throw error;
}

class Outer extends Component<{ children: ReactNode }, { caught: boolean }> {
  override state = { caught: false };
  static getDerivedStateFromError() {
    return { caught: true };
  }
  override render() {
    return this.state.caught ? <p>caught above</p> : this.props.children;
  }
}

it('shows what it wraps while nothing has failed', () => {
  render(
    <ChunkBoundary onReload={vi.fn()}>
      <p>the feature</p>
    </ChunkBoundary>,
  );
  expect(screen.getByText('the feature')).toBeVisible();
});

it('offers a reload for a chunk that did not arrive', async () => {
  const user = userEvent.setup();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const onReload = vi.fn();
  render(
    <ChunkBoundary onReload={onReload}>
      <Throws error={new ChunkLoadError(new TypeError('Failed to fetch'))} />
    </ChunkBoundary>,
  );
  expect(screen.getByRole('alert')).toHaveTextContent(
    'This part of the console could not be loaded',
  );
  await user.click(screen.getByRole('button', { name: 'Reload the console' }));
  expect(onReload).toHaveBeenCalledOnce();
});

it('throws any other failure on to the boundary above', () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  render(
    <Outer>
      <ChunkBoundary onReload={vi.fn()}>
        <Throws error={new Error('broken')} />
      </ChunkBoundary>
    </Outer>,
  );
  expect(screen.getByText('caught above')).toBeVisible();
});

it('passes axe in both themes', async () => {
  expect(await axeInBothThemes(() => <ChunkFailed onReload={vi.fn()} />)).toEqual({
    light: [],
    dark: [],
  });
});
