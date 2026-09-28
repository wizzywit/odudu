import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import rawCss from '#/shared/view/Button.module.css?raw';
import { Button } from '#/shared/view/Button.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

it('presses from the pointer and from the keyboard', async () => {
  const user = userEvent.setup();
  const onPress = vi.fn();
  render(<Button onPress={onPress}>Save</Button>);
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await user.keyboard('{Enter}');
  await user.keyboard(' ');
  expect(onPress).toHaveBeenCalledTimes(3);
});

it('does not press while disabled', async () => {
  const user = userEvent.setup();
  const onPress = vi.fn();
  render(
    <Button onPress={onPress} isDisabled>
      Save
    </Button>,
  );
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(onPress).not.toHaveBeenCalled();
});

it('passes axe in both themes in every variant', async () => {
  expect(
    await axeInBothThemes(() => (
      <>
        <Button variant="primary">Save</Button>
        <Button>Cancel</Button>
        <Button variant="quiet">Dismiss</Button>
        <Button variant="danger">Delete</Button>
      </>
    )),
  ).toEqual({ light: [], dark: [] });
});

it('looks disabled in every variant, not only the default one', () => {
  const css = rawCss.replace(/\/\*[\s\S]*?\*\//gu, '');
  const rules = [...css.matchAll(/([^{}]+)\{/gu)].map(([, selector = '']) => selector.trim());
  const disabled = rules.findIndex(
    (selector) => selector === '.button[data-variant][data-disabled]',
  );
  const lastVariant = rules.findLastIndex((selector) => selector.includes('[data-variant='));
  expect(disabled).toBeGreaterThan(lastVariant);
});
