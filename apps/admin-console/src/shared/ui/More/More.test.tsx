import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { More } from '#/shared/ui/More';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

it('folds its text away until the summary is pressed', async () => {
  render(<More>The rest of it.</More>);
  const body = screen.getByText('The rest of it.');
  expect(body).not.toBeVisible();
  await userEvent.click(screen.getByText('More'));
  expect(body).toBeVisible();
});

it('passes axe in both themes', async () => {
  expect(await axeInBothThemes(() => <More>The rest of it.</More>)).toEqual({
    light: [],
    dark: [],
  });
});
