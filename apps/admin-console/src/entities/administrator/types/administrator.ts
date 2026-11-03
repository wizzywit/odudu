export type AdministratorCall = 'create' | 'grant' | 'password';

// Each request adding or removing an administrator makes, by what its route
// needs (ADMIN_ROUTES in @odudu/protocol-admin). A cross-tenant caller's
// capabilities are its own tenant's, so `system`'s whoami answers for them.
export type AdministratorRequest =
  | 'create'
  | 'clients'
  | 'roles'
  | 'subject-roles'
  | 'set-roles'
  | 'password'
  // Looking for a subject whose creation's answer was lost.
  | 'find';
