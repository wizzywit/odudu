import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { LastAction } from '#/shared/ui/LastAction';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

it('is a status named for the action, empty until something was done', () => {
  render(
    <LastAction label="Last revoke" count={0}>
      {null}
    </LastAction>,
  );
  const line = screen.getByRole('status', { name: 'Last revoke' });
  expect(line).toBeEmptyDOMElement();
  expect(line).not.toHaveFocus();
});

it('takes the focus each time the count rises, and not otherwise', () => {
  const { rerender } = render(
    <LastAction label="Last revoke" count={0}>
      {null}
    </LastAction>,
  );
  const line = screen.getByRole('status', { name: 'Last revoke' });
  rerender(
    <LastAction label="Last revoke" count={1}>
      Revoked.
    </LastAction>,
  );
  expect(line).toHaveFocus();
  expect(line).toHaveTextContent('Revoked.');
  line.blur();
  rerender(
    <LastAction label="Last revoke" count={1}>
      Revoked.
    </LastAction>,
  );
  expect(line).not.toHaveFocus();
  rerender(
    <LastAction label="Last revoke" count={2}>
      Revoked again.
    </LastAction>,
  );
  expect(line).toHaveFocus();
});

it('has no accessibility violations in either theme', async () => {
  expect(
    await axeInBothThemes(() => (
      <LastAction label="Last revoke" count={1}>
        Revoked.
      </LastAction>
    )),
  ).toEqual({ light: [], dark: [] });
});
