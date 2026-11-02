import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { RecordActivity } from '#/shared/ui/RecordActivity';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

// The trail itself needs the router and the gateway; the record pages' own
// tests read it through this component.
function refused() {
  return (
    <main>
      <RecordActivity
        resource="group"
        tenant="acme"
        id="g1"
        lead="Every change made to this group, and every change refused."
        readable={false}
      />
    </main>
  );
}

it('says what the trail holds, and names view-audit where the audit is not readable', () => {
  render(refused());
  expect(screen.getByText(/^Every change made to this group/u)).toBeVisible();
  expect(screen.getByRole('note')).toHaveTextContent('Activity needs the view-audit capability.');
});

it('has no accessibility violations in either theme, refused', async () => {
  expect(await axeInBothThemes(refused)).toEqual({ light: [], dark: [] });
});
