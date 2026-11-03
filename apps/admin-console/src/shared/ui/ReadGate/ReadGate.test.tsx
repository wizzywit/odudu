import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ReadGate } from '#/shared/ui/ReadGate';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

function read(overrides: Partial<Parameters<typeof ReadGate<string>>[0]['read']> = {}) {
  return {
    status: 'ready',
    data: 'the record',
    etag: '"e1"',
    gone: false,
    retry: vi.fn(),
    ...overrides,
  };
}

function gate(own: ReturnType<typeof read>) {
  return (
    <ReadGate
      read={own}
      label="Loading the groups"
      fields={2}
      failed="The groups could not be loaded"
    >
      {(data, etag) => <p>{`${data} ${etag}`}</p>}
    </ReadGate>
  );
}

it('shows a placeholder named for what is loading until the read answers', () => {
  render(gate(read({ status: 'loading', data: undefined, etag: null })));
  expect(screen.getByRole('status')).toHaveTextContent('Loading the groups');
});

it('hands the record and its ETag to what it draws', () => {
  render(gate(read()));
  expect(screen.getByText('the record "e1"')).toBeVisible();
});

it.each([
  ['no record', { data: undefined }],
  ['no ETag', { etag: null }],
])('says the read failed, and asks again, when the read answered %s', async (_, answer) => {
  const user = userEvent.setup();
  const own = read({ status: 'failed', ...answer });
  render(gate(own));
  expect(screen.getByText('The groups could not be loaded')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(own.retry).toHaveBeenCalledOnce();
});

it('has no accessibility violations in either theme', async () => {
  expect(await axeInBothThemes(() => gate(read({ data: undefined, status: 'failed' })))).toEqual({
    light: [],
    dark: [],
  });
});
