import { readable } from '#/shared/lib/services/access';
import { withSearch } from '#/shared/lib/services/address';
import { TENANT_ROLE_TEXT } from '#/shared/lib/services/capabilities';
import type { Authority } from '#/shared/lib/services/principal';

export const ROLES_CAPABILITY = 'manage-tenant';

// The role list answers to manage-tenant, and to view-users, which a holder
// of manage-users has. Until whoami answers nothing is ruled out.
export function rolesReadable(authority: Authority | undefined): boolean {
  return readable(authority, 'manage-tenant') || readable(authority, 'view-users');
}

// The roles list that narrows to this client's own, where every filter applies.
export function clientRolesListHref(rolesHref: string, clientDbId: string): string {
  return withSearch(rolesHref, { client: clientDbId });
}

export const ROLES_OPEN_LABEL = 'Open them in Roles';
export const NEW_ROLE_NAME_LABEL = 'Role name';

export const CLIENT_ROLES_RULE =
  "The roles scoped to this client. A token carries one as the client's ID, a colon and its name, so two clients may each have a role of the same name.";

export const NO_CLIENT_ROLES = 'This client has no role of its own yet.';

export const NEW_ROLE_HEADING = 'New role';
export const NEW_ROLE_RULE =
  'A role made here belongs to this client for good: its name and its owner cannot be changed.';

export const ROLE_NAME_TAKEN = 'This client already has a role of that name.';

export const NAME_REQUIRED = 'Enter a name.';

// Whose a role is beside the account's roles: the tenant's, or a client's by its key.
export function roleOwnerLine(client: string | null): string {
  return client === null ? TENANT_ROLE_TEXT : `Scoped to ${client}.`;
}
