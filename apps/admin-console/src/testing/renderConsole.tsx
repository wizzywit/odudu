import { createMemoryHistory } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { App } from '#/app/App';
import { beforeAll } from 'vitest';
import { createConsoleRouter, preloadFeatures } from '#/app/router';
import { createReadCache } from '#/shared/lib/repository/readCache';
import { ACME_ADMIN } from '#/testing/tenantPaths';
import { fakeTransport, json, type Answer } from '#/testing/fakeTransport';

// A feature's chunk is transformed the first time a file renders it; paid
// here, against the hook's own timeout, rather than inside a find.
export function preloadConsoleRoutes(): Promise<void> {
  return preloadFeatures();
}

// Its own budget: all four feature graphs load here, on a busy runner too.
beforeAll(preloadConsoleRoutes, 60_000);

export const GRACE = { tenant: 'acme', subject_id: 's1', username: 'grace' };
export const ROOT = { tenant: 'system', subject_id: 's0', username: 'root' };

export function whoami(capabilities: readonly string[], crossTenant = false): Answer {
  return json({ subjectId: 's', issuerTenantId: 't', capabilities, crossTenant });
}

// grace of acme holding the capabilities given, answering a page's own routes
// besides; `extra` wins over both.
export function graceRoutes(
  capabilities: readonly string[],
  page: Record<string, Answer>,
  extra: Record<string, Answer>,
): Record<string, Answer> {
  return {
    'GET /console/api/session': json(GRACE),
    [`GET ${ACME_ADMIN}/whoami`]: whoami(capabilities),
    ...page,
    ...extra,
  };
}

// The whole console at one address, over a fake gateway, as a page renders it.
export function consoleAt(path: string, routes: Record<string, Answer>) {
  const fake = fakeTransport(routes);
  const router = createConsoleRouter(createMemoryHistory({ initialEntries: [path] }));
  const queryClient = createReadCache();
  const element = <App router={router} transport={fake.transport} queryClient={queryClient} />;
  return { ...fake, router, queryClient, element };
}

export function renderConsoleAt(path: string, routes: Record<string, Answer>) {
  const { element, ...rest } = consoleAt(path, routes);
  const view = render(element);
  return { ...rest, unmount: view.unmount };
}
