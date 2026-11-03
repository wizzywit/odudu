import { TENANT_ADMIN } from '#/shared/lib/services/capabilities';

// A tenant may make a client role of its own named `tenant-admin`, so the
// one that grants the console is found through the built-in client.
export function builtinAdminClient(
  clients: readonly { id: string; builtin_admin: boolean }[],
): string | null {
  return clients.find((client) => client.builtin_admin)?.id ?? null;
}

interface ClientRole {
  id: string;
  name: string;
  client_id: string | null;
}

export function clientRole(
  roles: readonly ClientRole[],
  adminClient: string,
  name: string,
): string | null {
  return roles.find((role) => role.name === name && role.client_id === adminClient)?.id ?? null;
}

export function tenantAdminRole(roles: readonly ClientRole[], adminClient: string): string | null {
  return clientRole(roles, adminClient, TENANT_ADMIN);
}

export function withRole(held: readonly string[], role: string): readonly string[] {
  return held.includes(role) ? held : [...held, role];
}
