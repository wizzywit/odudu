import type { Client } from '@odudu/contracts/admin';
import { ADMIN_CLIENT_KEY } from '#/shared/service/capabilities';
import { lastChosen } from '#/shared/service/picker';
import type { ListStatus } from '#/shared/service/resourceList';

type TestClientOption = Pick<Client, 'id' | 'name' | 'client_id'>;

export const TEST_AS_LABEL = 'Send as client';

export const TEST_TENANT_OWN = 'Use the tenant’s own look';

export const TEST_AS_RULE =
  'The message wears the tenant’s published theme. Choose a client to send the mail its sign-in would send: its theme over the tenant’s.';

// What the administrator has chosen: nothing yet, the tenant's own look, or a
// client by its row id.
export type TestClientChoice =
  { kind: 'default' } | { kind: 'tenant' } | { kind: 'client'; id: string };

export const DEFAULT_TEST_CLIENT: TestClientChoice = { kind: 'default' };

// Untouched, the test is sent as the client the administrator signed in with,
// the tenant's own `odudu-admin`, when the list read holds it; otherwise, and
// while the list is not loaded or may not be read, as the tenant's own look.
export function testClientId(
  choice: TestClientChoice,
  status: ListStatus,
  options: readonly TestClientOption[],
): string | null {
  if (choice.kind === 'tenant') return null;
  if (choice.kind === 'client') return choice.id;
  if (status !== 'ready') return null;
  return options.find((option) => option.client_id === ADMIN_CLIENT_KEY)?.id ?? null;
}

export function chosenTestClient(ids: readonly string[]): TestClientChoice {
  const id = lastChosen(ids);
  return id === null ? { kind: 'tenant' } : { kind: 'client', id };
}

export function testClientSelection(id: string | null): string[] {
  return id === null ? [] : [id];
}

export function testClientSummary(id: string | null, options: readonly TestClientOption[]): string {
  const found = options.find((option) => option.id === id);
  if (id === null || found === undefined) return 'Sent in the tenant’s own look.';
  return found.client_id === ADMIN_CLIENT_KEY
    ? `Sent as ${found.name}, the client you signed in with.`
    : `Sent as ${found.name}.`;
}
