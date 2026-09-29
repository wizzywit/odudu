import { QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { createQueryClient } from '#/shared/repository/queryClient.ts';
import { useActivity } from '#/shared/repository/useActivity.ts';
import { parseSearch, stringifySearch } from '#/shared/service/search.ts';
import { TransportContext } from '#/shared/transport/useTransport.ts';
import { fakeTransport, json } from '#/testing/fakeTransport.ts';

const AUDIT = 'GET /console/api/admin/tenants/acme/audit';

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
          actor_origin: 'tenant',
          resource_type: 'client',
          resource_id: 'c1',
          request_id: null,
          ip: null,
          detail: {},
        },
      ],
    }),
  });
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: '/acme/clients/c1',
    component: Activity,
  });
  const router = createRouter({
    routeTree: root.addChildren([page]),
    history: createMemoryHistory({
      initialEntries: ['/console/acme/clients/c1?tab=activity&after=b2Zmc2V0LTE.dGFnMQ'],
    }),
    basepath: '/console',
    parseSearch,
    stringifySearch,
  });
  render(
    <TransportContext value={fake.transport}>
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </TransportContext>,
  );
  expect(await screen.findByText('rows 1')).toBeVisible();
  expect(fake.sent.map((request) => `${request.path}?${request.search.toString()}`)).toEqual([
    '/console/api/admin/tenants/acme/audit?resource_type=client&resource_id=c1&cursor=b2Zmc2V0LTE.dGFnMQ',
  ]);
});
