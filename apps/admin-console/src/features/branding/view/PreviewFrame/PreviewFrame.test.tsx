import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { PreviewFrame } from '#/features/branding/view/PreviewFrame/PreviewFrame';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

const frame = (loading: boolean, onLoaded = () => undefined) => (
  <PreviewFrame title="A preview" src="/x" frameKey="k" loading={loading} onLoaded={onLoaded} />
);

it('frames the address it is given, allowing nothing', () => {
  render(frame(false));
  const iframe = screen.getByTitle('A preview');
  expect(iframe).toHaveAttribute('src', '/x');
  expect(iframe).toHaveAttribute('sandbox', '');
  expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer');
});

it('says it is loading while it is, and not after', () => {
  const { rerender } = render(frame(true));
  expect(screen.getByRole('status')).toHaveTextContent('Loading the preview');
  rerender(frame(false));
  expect(screen.queryByRole('status')).toBeNull();
});

it('tells when the frame has loaded', () => {
  const onLoaded = vi.fn();
  render(frame(true, onLoaded));
  screen.getByTitle('A preview').dispatchEvent(new Event('load'));
  expect(onLoaded).toHaveBeenCalledOnce();
});

it('says the preview could not be shown, with a way to ask again, and hides the frame', async () => {
  const retry = vi.fn();
  render(
    <PreviewFrame
      title="A preview"
      src="/x"
      frameKey="k"
      loading={false}
      retry={retry}
      onLoaded={() => undefined}
    />,
  );
  expect(screen.getByRole('alert')).toHaveTextContent('The preview could not be shown.');
  expect(screen.queryByRole('status')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(retry).toHaveBeenCalledOnce();
});

it('has nothing axe can find in either theme, framed or failed', async () => {
  const found = await axeInBothThemes(
    () => (
      <>
        {frame(false)}
        <PreviewFrame
          title="Another preview"
          src="/y"
          frameKey="j"
          loading={false}
          retry={() => undefined}
          onLoaded={() => undefined}
        />
      </>
    ),
    () => Promise.resolve(),
    {
      frames: false,
    },
  );
  expect(found).toEqual({ light: [], dark: [] });
});
