import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import type { MailTab } from '#/features/branding/usecase/useMailTab';
import { MailClientChoice } from '#/features/branding/view/MailClientChoice/MailClientChoice';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { pickerState } from '#/testing/pickerState';

const BILLING = {
  id: 'c1',
  name: 'Billing',
  client_id: 'billing',
  type: 'confidential' as const,
};

function mailWith(changes: Partial<MailTab> = {}): MailTab {
  // Only what the choice reads; the rest of the tab is its frame and lists.
  return {
    client: null,
    picker: pickerState([BILLING]),
    chooseClient: vi.fn(),
    showTenantOwn: vi.fn(),
    ...changes,
  } as unknown as MailTab;
}

it('offers the tenant’s clients and reports the one chosen', async () => {
  const user = userEvent.setup();
  const chooseClient = vi.fn();
  render(<MailClientChoice mail={mailWith({ chooseClient })} />);
  await user.click(screen.getByRole('option', { name: /Billing/u }));
  expect(chooseClient).toHaveBeenCalledWith(['c1']);
  expect(screen.queryByRole('button', { name: 'Show the tenant’s own' })).toBeNull();
});

it('goes back to the tenant’s own look once a client is chosen', async () => {
  const user = userEvent.setup();
  const showTenantOwn = vi.fn();
  render(
    <MailClientChoice mail={mailWith({ client: { id: 'c1', name: 'Billing' }, showTenantOwn })} />,
  );
  await user.click(screen.getByRole('button', { name: 'Show the tenant’s own' }));
  expect(showTenantOwn).toHaveBeenCalledOnce();
});

it('has nothing axe can find in either theme', async () => {
  const found = await axeInBothThemes(
    () => <MailClientChoice mail={mailWith()} />,
    () => screen.findByRole('option', { name: /Billing/u }),
  );
  expect(found).toEqual({ light: [], dark: [] });
});
