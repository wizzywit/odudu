import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { AssistantButton } from '#/entities/assistant/ui/AssistantButton';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

function button(over: { expanded?: boolean; onPress?: (opener: HTMLElement) => void } = {}) {
  return (
    <AssistantButton
      label="Ask the assistant"
      shortLabel="Ask"
      hintLead="or press"
      shortcut="Control+K"
      expanded={over.expanded ?? false}
      panelId="panel"
      onPress={over.onPress ?? (() => undefined)}
    />
  );
}

it('is a labelled button that names its shortcut and what it controls once open', () => {
  const { rerender } = render(button());
  const control = screen.getByRole('button', { name: 'Ask the assistant' });
  expect(control).toHaveAttribute('aria-keyshortcuts', 'Control+K');
  expect(control).toHaveAttribute('aria-expanded', 'false');
  expect(control).not.toHaveAttribute('aria-controls');
  rerender(button({ expanded: true }));
  expect(control).toHaveAttribute('aria-expanded', 'true');
  expect(control).toHaveAttribute('aria-controls', 'panel');
});

it('hands the element that was pressed to the page, so focus can return to it', async () => {
  const user = userEvent.setup();
  const onPress = vi.fn<(opener: HTMLElement) => void>();
  render(button({ onPress }));
  await user.click(screen.getByRole('button', { name: 'Ask the assistant' }));
  expect(onPress).toHaveBeenCalledWith(screen.getByRole('button', { name: 'Ask the assistant' }));
});

it('shows the shortcut beside the label without reading it out twice', () => {
  render(button());
  expect(screen.getByText(/or press/u)).toHaveAttribute('aria-hidden', 'true');
});

it('passes axe in both themes', async () => {
  expect(await axeInBothThemes(() => button())).toEqual({ light: [], dark: [] });
});

it('draws a shorter word where the bar is narrow, and is named by the whole label either way', () => {
  render(button());
  const control = screen.getByRole('button', { name: 'Ask the assistant' });
  expect(control).toHaveAttribute('aria-label', 'Ask the assistant');
  expect(control).toHaveTextContent('Ask the assistant');
  expect(control).toHaveTextContent('Ask');
  expect(control.querySelector('[data-short]')).toHaveTextContent('Ask');
  expect(control.querySelector('[data-full]')).toHaveTextContent('Ask the assistant');
});
