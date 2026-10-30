import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { SlotThumbnail } from '#/features/branding/view/SlotThumbnail';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

const SRC = 'data:image/png;base64,iVBOR/8=';

it('shows nothing for a slot that holds no image', () => {
  const { container } = render(
    <SlotThumbnail slot="favicon" thumbnail={{ status: 'none' }} alt={null} />,
  );
  expect(container).toBeEmptyDOMElement();
});

it('shows the image under the logo’s own alt text', () => {
  render(<SlotThumbnail slot="logo" thumbnail={{ status: 'ready', data: SRC }} alt="Acme" />);
  const picture = screen.getByRole('img', { name: 'Acme' });
  expect(picture).toHaveAttribute('src', SRC);
});

it('names an image with no alt text of its own after its slot', () => {
  render(<SlotThumbnail slot="background" thumbnail={{ status: 'ready', data: SRC }} alt={null} />);
  expect(screen.getByRole('img', { name: 'Background image' })).toBeVisible();
});

it('says it is loading, in a status the screen reader announces politely', () => {
  render(<SlotThumbnail slot="logo" thumbnail={{ status: 'loading' }} alt="Acme" />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading the image…');
  expect(screen.queryByRole('img')).toBeNull();
});

it('says it failed and offers to try again', async () => {
  const retry = vi.fn();
  render(
    <SlotThumbnail
      slot="logo"
      thumbnail={{ status: 'failed', refused: false, retry }}
      alt="Acme"
    />,
  );
  expect(screen.getByText('The image could not be shown.')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(retry).toHaveBeenCalledTimes(1);
});

it('says nothing more than it failed for a caller the server refused', () => {
  render(
    <SlotThumbnail
      slot="logo"
      thumbnail={{ status: 'failed', refused: true, retry: vi.fn() }}
      alt="Acme"
    />,
  );
  expect(screen.getByText('The image could not be shown.')).toBeVisible();
});

it('has nothing axe can find in either theme, in any state', async () => {
  const states = [
    { status: 'ready', data: SRC },
    { status: 'loading' },
    { status: 'failed', refused: false, retry: vi.fn() },
  ] as const;
  for (const thumbnail of states) {
    const found = await axeInBothThemes(
      () => <SlotThumbnail slot="logo" thumbnail={thumbnail} alt="Acme" />,
      () => Promise.resolve(document.body),
      { frames: false },
    );
    expect(found).toEqual({ light: [], dark: [] });
  }
});
