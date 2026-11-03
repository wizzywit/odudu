import { screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { createQueryClient } from '#/shared/repository/queryClient';
import { useActivity } from '#/features/record-activity/repository/useActivity';
import { fakeTransport, json } from '#/testing/fakeTransport';
import { mountAtRoute } from '#/testing/mountAtRoute';
import { ACME_ADMIN } from '#/testing/tenantPaths';

const AUDIT = `GET ${ACME_ADMIN}/audit`;

function Activity() {
  const list = useActivity({ tenant: 'acme', resourceType: 'client', resourceId: 'c1' });
  return <p>{`rows ${String(list.rows.length)}`}</p>;
}

it('reads the audit trail narrowed to the record, from the cursor the address holds', async () => {
  const fake = fakeTransport({
    [AUDIT]: json({
      items: [
        {
          id: 'a1',
          occurred_at: '2026-09-28T13:41:05Z',
          event_type: 'admin_mutation',
          action: 'client.update',
          outcome: 'allowed',
          actor_tenant_id: null,
          actor_subject_id: null,
          actor_client_id: null,
          actor_name: null,
          actor_origin: null,
          resource_type: 'client',
          resource_id: 'c1',
          request_id: null,
          ip: null,
          detail: {},
        },
      ],
    }),
  });
  mountAtRoute(
    '/console/acme/clients/c1?tab=activity&after=b2Zmc2V0LTE.dGFnMQ',
    '/acme/clients/c1',
    Activity,
    {
      basepath: '/console',
      providers: { transport: fake.transport, queryClient: createQueryClient() },
    },
  );
  expect(await screen.findByText('rows 1')).toBeVisible();
  expect(fake.sent.map((request) => `${request.path}?${request.search.toString()}`)).toEqual([
    `${ACME_ADMIN}/audit?resource_type=client&resource_id=c1&cursor=b2Zmc2V0LTE.dGFnMQ`,
  ]);
});
