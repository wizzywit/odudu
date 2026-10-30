import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { DEFAULT_PREVIEW } from '#/features/branding/service';
import type { Preview } from '#/features/branding/usecase/usePreview';
import { PreviewPane } from '#/features/branding/view/PreviewPane';

function preview(changes: Partial<Preview> = {}): Preview {
  return {
    choice: DEFAULT_PREVIEW,
    src: '/console/api/admin/tenants/acme/theme/preview?kind=sign-in&scheme=light',
    frameKey: 'k',
    note: null,
    fallback: [],
    loading: false,
    onLoaded: () => undefined,
    setKind: () => undefined,
    setScheme: () => undefined,
    ...changes,
  };
}

it('frames the address it is given, allowing nothing', () => {
  render(<PreviewPane preview={preview()} pickKind />);
  const frame = screen.getByTitle('Preview of the page');
  expect(frame).toHaveAttribute('sandbox', '');
  expect(frame).toHaveAttribute('src', preview().src);
});

it('says the preview is loading, and hides the frame meanwhile', () => {
  render(<PreviewPane preview={preview({ loading: true })} pickKind />);
  expect(screen.getByText('Loading the preview')).toBeVisible();
});

it('says the preview could not be shown, and asks again when told to', async () => {
  const retry = vi.fn();
  render(<PreviewPane preview={preview({ retry })} pickKind />);
  expect(screen.getByRole('alert')).toHaveTextContent('The preview could not be shown.');
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(retry).toHaveBeenCalledOnce();
});

it('offers the page picker only where the editor does not', () => {
  const { rerender } = render(<PreviewPane preview={preview()} pickKind />);
  expect(screen.getByRole('button', { name: /Page/u })).toBeVisible();
  rerender(<PreviewPane preview={preview()} pickKind={false} />);
  expect(screen.queryByRole('button', { name: /Page/u })).toBeNull();
});

it('says nothing about a fallback when there is none to say', () => {
  render(<PreviewPane preview={preview()} pickKind />);
  expect(screen.queryAllByRole('note')).toEqual([]);
});

it('says, beside the frame, each thing the preview shows other than the saved draft', () => {
  render(
    <PreviewPane
      preview={preview({
        fallback: [
          'The draft names an image that no longer exists.',
          'The preview shows Instrument’s default look instead.',
        ],
      })}
      pickKind
    />,
  );
  const group = screen.getByRole('status', { name: 'What the preview shows' });
  expect(
    within(group)
      .getAllByRole('note')
      .map((n) => n.textContent),
  ).toEqual([
    'The draft names an image that no longer exists.',
    'The preview shows Instrument’s default look instead.',
  ]);
});

it('has nothing axe can find in either theme', async () => {
  const found = await axeInBothThemes(
    () => (
      <PreviewPane
        preview={preview({ note: 'Left out.', fallback: ['The draft could not be read.'] })}
        pickKind
      />
    ),
    () => Promise.resolve(),
    { frames: false },
  );
  expect(found).toEqual({ light: [], dark: [] });
});

it('keeps its notice in one polite live region that stays in place as the lines change', () => {
  const { rerender } = render(<PreviewPane preview={preview()} pickKind />);
  const region = screen.getByRole('status', { name: 'What the preview shows' });
  expect(region).toBeEmptyDOMElement();
  rerender(
    <PreviewPane preview={preview({ fallback: ['The draft could not be read.'] })} pickKind />,
  );
  expect(screen.getByRole('status', { name: 'What the preview shows' })).toBe(region);
  expect(region).toHaveTextContent('The draft could not be read.');
});
