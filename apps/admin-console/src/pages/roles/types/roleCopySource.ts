import type { Role } from '#/entities/role';

// The role a copy is made from, and the roles it nests.
export interface RoleCopySource {
  role: Role;
  children: Role[];
}
