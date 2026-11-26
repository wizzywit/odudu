import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { firstRunNotice } from '#/widgets/assistant-panel/services/firstRun';
import { PANEL_WORDING } from '#/widgets/assistant-panel/services/wording';
import { FirstRunNotice } from '#/widgets/assistant-panel/ui/FirstRunNotice';

const NOTICE = firstRunNotice({ kind: 'bedrock' });

it('says where messages go and who can read them, and does not take the focus', () => {
  render(<FirstRunNotice notice={NOTICE} words={PANEL_WORDING} onDismiss={vi.fn<() => void>()} />);
  const region = screen.getByRole('region', { name: 'Before you start' });
  expect(region).toHaveTextContent('Amazon Bedrock');
  expect(region).toHaveTextContent('audit trail');
  expect(document.body).toHaveFocus();
});

it('is dismissed from its button', async () => {
  const user = userEvent.setup();
  const onDismiss = vi.fn<() => void>();
  render(<FirstRunNotice notice={NOTICE} words={PANEL_WORDING} onDismiss={onDismiss} />);
  await user.click(screen.getByRole('button', { name: 'Got it' }));
  expect(onDismiss).toHaveBeenCalledTimes(1);
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(() => (
      <FirstRunNotice notice={NOTICE} words={PANEL_WORDING} onDismiss={vi.fn<() => void>()} />
    )),
  ).toEqual({ light: [], dark: [] });
});
