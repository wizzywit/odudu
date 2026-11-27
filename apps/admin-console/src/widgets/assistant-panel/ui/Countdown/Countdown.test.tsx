import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { Countdown } from '#/widgets/assistant-panel/ui/Countdown';

it('shows the time as text, and announces nothing until it has words to say', () => {
  const { rerender } = render(
    <Countdown text="Expires in 4 min" announcement="" expired={false} />,
  );
  expect(screen.getByText('Expires in 4 min')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('');
  rerender(
    <Countdown text="Expires in 40 s" announcement="One minute left to decide" expired={false} />,
  );
  expect(screen.getByRole('status')).toHaveTextContent('One minute left to decide');
  rerender(<Countdown text="Expired" announcement="The approval expired" expired={true} />);
  expect(screen.getByRole('status')).toHaveTextContent('The approval expired');
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(() => (
      <Countdown text="Expires in 4 min" announcement="" expired={false} />
    )),
  ).toEqual({ light: [], dark: [] });
});
