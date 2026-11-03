import { QueryClient } from '@tanstack/react-query';
import { screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { RecordActivity } from '#/features/record-activity/ui/RecordActivity';
import { fakeTransport } from '#/testing/fakeTransport';
import { mountAtRoute } from '#/testing/mountAtRoute';

// The trail itself needs the router and the gateway; the record pages' own
// tests read it through this component.
function Refused() {
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

it('says what the trail holds, names view-audit where the audit is not readable, and asks for nothing', async () => {
  const fake = fakeTransport({});
  mountAtRoute('/console/acme/groups/g1', '/acme/groups/g1', Refused, {
    basepath: '/console',
    providers: { transport: fake.transport, queryClient: new QueryClient() },
  });
  expect(await screen.findByText(/^Every change made to this group/u)).toBeVisible();
  expect(screen.getByRole('note')).toHaveTextContent('Activity needs the view-audit capability.');
  expect(fake.sent).toEqual([]);
});
