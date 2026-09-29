import { createMemoryHistory } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { App } from '#/app/App.tsx';
import { beforeAll } from 'vitest';
import { createConsoleRouter, preloadFeatures } from '#/app/router.tsx';
import { createQueryClient } from '#/shared/repository/queryClient.ts';
import { useDrafts } from '#/shared/repository/useDrafts.ts';
import { useToasts } from '#/shared/repository/useToasts.ts';
import { useUnsavedGuard } from '#/shared/repository/useUnsavedGuard.ts';
import { fakeTransport, json, type Answer } from '#/testing/fakeTransport.ts';

// A feature's chunk is transformed the first time a file renders it; paid
// here, against the hook's own timeout, rather than inside a find.
export function preloadConsoleRoutes(): Promise<void> {
  return preloadFeatures();
}

beforeAll(preloadConsoleRoutes);

export const GRACE = { tenant: 'acme', subject_id: 's1', username: 'grace' };
export const ROOT = { tenant: 'system', subject_id: 's0', username: 'root' };

export function whoami(capabilities: readonly string[], crossTenant = false): Answer {
  return json({ subjectId: 's', issuerTenantId: 't', capabilities, crossTenant });
}

// The whole console at one address, over a fake gateway, as a page renders it.
export function consoleAt(path: string, routes: Record<string, Answer>) {
  const fake = fakeTransport(routes);
  const router = createConsoleRouter(createMemoryHistory({ initialEntries: [path] }));
  const element = (
    <App router={router} transport={fake.transport} queryClient={createQueryClient()} />
  );
  return { ...fake, router, element };
}

export function renderConsoleAt(path: string, routes: Record<string, Answer>) {
  const { element, ...rest } = consoleAt(path, routes);
  const view = render(element);
  return { ...rest, unmount: view.unmount };
}

// The stores outlive a render, so a test that mounts the console clears them after.
export function resetConsole(): void {
  useToasts.setState({ toasts: [] });
  useUnsavedGuard.getState().reset();
  useDrafts.getState().forgetAll();
}
