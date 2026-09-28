import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { Button } from '#/shared/view/Button.tsx';
import { SecretDialog } from '#/shared/view/SecretDialog.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

const SECRET = 'Qm9vay1vZi1zZWNyZXRzLTdmM2E5YzFlLWQyYjQ';

afterEach(() => {
  vi.restoreAllMocks();
});

function Harness({ onClose = vi.fn() }: { readonly onClose?: () => void }) {
  const [secret, setSecret] = useState<string | null>(null);
  return (
    <>
      <Button
        onPress={() => {
          setSecret(SECRET);
        }}
      >
        Generate a new secret
      </Button>
      <SecretDialog
        secret={secret}
        title="New client secret"
        label="client secret"
        onClose={() => {
          onClose();
          setSecret(null);
        }}
      >
        It replaces the old secret at once.
      </SecretDialog>
    </>
  );
}

function textNodesHolding(value: string): Text[] {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const found: Text[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node instanceof Text && node.data.includes(value)) found.push(node);
  }
  return found;
}

function attributesHolding(value: string): string[] {
  return [...document.querySelectorAll('*')].flatMap((element) =>
    [...element.attributes]
      .filter((attribute) => attribute.value.includes(value))
      .map((attribute) => `${element.tagName}[${attribute.name}]`),
  );
}

it('shows the secret in exactly one visible text node and in no attribute', async () => {
  const user = userEvent.setup();
  const logged = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
    vi.spyOn(console, method),
  );
  render(<Harness />);
  await user.click(screen.getByRole('button', { name: 'Generate a new secret' }));
  expect(screen.getByRole('dialog', { name: 'New client secret' })).toBeInTheDocument();
  const nodes = textNodesHolding(SECRET);
  expect(nodes).toHaveLength(1);
  expect(nodes[0]?.data).toBe(SECRET);
  expect(nodes[0]?.parentElement).toBeVisible();
  expect(attributesHolding(SECRET)).toEqual([]);
  for (const spy of logged) {
    expect(JSON.stringify(spy.mock.calls)).not.toContain(SECRET);
  }
});

it('copies the whole secret', async () => {
  const user = userEvent.setup();
  render(<Harness />);
  await user.click(screen.getByRole('button', { name: 'Generate a new secret' }));
  await user.click(screen.getByRole('button', { name: 'Copy client secret' }));
  expect(await navigator.clipboard.readText()).toBe(SECRET);
});

it('cannot be closed, by button or by Escape, before the acknowledgement', async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  render(<Harness onClose={onClose} />);
  await user.click(screen.getByRole('button', { name: 'Generate a new secret' }));
  const close = screen.getByRole('button', { name: 'Close' });
  expect(close).toBeDisabled();
  await user.click(close);
  await user.keyboard('{Escape}');
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog', { name: 'New client secret' })).toBeInTheDocument();
});

it('closes once acknowledged, returning focus to what opened it', async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  render(<Harness onClose={onClose} />);
  const trigger = screen.getByRole('button', { name: 'Generate a new secret' });
  await user.click(trigger);
  await user.click(
    screen.getByRole('checkbox', {
      name: 'I have stored the client secret. It will not be shown again.',
    }),
  );
  await user.click(screen.getByRole('button', { name: 'Close' }));
  expect(onClose).toHaveBeenCalledOnce();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(textNodesHolding(SECRET)).toEqual([]);
  await waitFor(() => {
    expect(trigger).toHaveFocus();
  });
});

it('asks for the acknowledgement afresh for the next secret', async () => {
  const user = userEvent.setup();
  render(<Harness />);
  await user.click(screen.getByRole('button', { name: 'Generate a new secret' }));
  await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByRole('button', { name: 'Close' }));
  await user.click(screen.getByRole('button', { name: 'Generate a new secret' }));
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(() => (
      <SecretDialog
        secret={SECRET}
        title="New client secret"
        label="client secret"
        onClose={vi.fn()}
      />
    )),
  ).toEqual({ light: [], dark: [] });
});

function reactKeysIn(element: Element): string[] {
  const fiberKey = Object.keys(element).find((key) => key.startsWith('__reactFiber$'));
  const keys: string[] = [];
  let fiber = (fiberKey === undefined ? undefined : Reflect.get(element, fiberKey)) as
    { key: string | null; return: unknown } | null | undefined;
  while (fiber !== null && fiber !== undefined) {
    if (fiber.key !== null) keys.push(fiber.key);
    fiber = fiber.return as typeof fiber;
  }
  return keys;
}

it('asks afresh when a different secret replaces the one shown, without keying on it', async () => {
  const user = userEvent.setup();
  const other = 'c2Vjb25kLXNlY3JldC0wMTkyZjdhNC04MWQw';
  const { rerender } = render(
    <SecretDialog
      secret={SECRET}
      title="New client secret"
      label="client secret"
      onClose={vi.fn()}
    />,
  );
  await user.click(screen.getByRole('checkbox'));
  expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled();
  rerender(
    <SecretDialog
      secret={other}
      title="New client secret"
      label="client secret"
      onClose={vi.fn()}
    />,
  );
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
  const keys = reactKeysIn(screen.getByRole('checkbox'));
  expect(keys.length).toBeGreaterThan(0);
  expect(keys.filter((key) => key.includes(SECRET) || key.includes(other))).toEqual([]);
});
