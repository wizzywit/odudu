import { ME_READ_SCOPE, ME_WRITE_SCOPE } from '@odudu/domain-tenant';

export type MeAccess = 'read' | 'write';

export function requiredScope(access: MeAccess): string {
  return access === 'write' ? ME_WRITE_SCOPE : ME_READ_SCOPE;
}

export function mayAccess(scopes: readonly string[], access: MeAccess): boolean {
  return scopes.includes(requiredScope(access));
}

// A token marked for an agent (`act`) reads like anyone's and never writes: a
// change to a person's account is theirs to make.
export function agentMayAccess(isAgent: boolean, access: MeAccess): boolean {
  return !isAgent || access === 'read';
}
