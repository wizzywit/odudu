import type { Role } from '@odudu/contracts/admin';
import {
  ADMIN_CLIENT_KEY,
  beyondCaller,
  ceilingOf,
  isAdminRole,
  isHolding,
  writeRefusal,
} from '#/shared/service/capabilities';
import { andList } from '#/shared/service/format.ts';
import type { AdminCapability } from '#/shared/service/principal.ts';

// Every role of the built-in admin client, which the server guards by the
// client rather than by the role's name.
export function isBuiltin(role: Pick<Role, 'client_key'>): boolean {
  return role.client_key === ADMIN_CLIENT_KEY;
}

type Reaching = Pick<Role, 'name' | 'client_key' | 'admin_reach'>;

// `admin_reach` is the server's judgement of what a role hands out, however
// deep it nests a capability: the same one each ceiling on its writes makes.
export function deleteBlock(role: Role, caller: readonly AdminCapability[]): string | null {
  if (isBuiltin(role)) {
    return deletionFixed(role);
  }
  const beyond = beyondCaller(role.admin_reach, caller);
  return beyond.length === 0
    ? null
    : `${role.name} reaches ${andList(beyond)}, which you do not hold, so you cannot delete it.`;
}

export function defaultBlock(role: Role): string | null {
  if (isBuiltin(role)) {
    return 'A capability of the built-in admin client is never handed to every new subject.';
  }
  if (role.default_for_new_subjects || role.admin_reach.length === 0) return null;
  return `It reaches ${andList(role.admin_reach)}, and a role every new subject receives may reach no admin capability. Take those composites out of it first.`;
}

// Giving a role or taking it out passes on what it reaches, so either is
// held to the caller's own capabilities.
export function removalBlock(
  child: Reaching,
  caller: readonly AdminCapability[],
  tenant: string,
): string | null {
  if (isAdminRole(child) && isHolding(child.name)) return ceilingOf(tenant, child.name, caller);
  const beyond = beyondCaller(child.admin_reach, caller);
  return beyond.length === 0
    ? null
    : `It reaches ${andList(beyond)}, which you do not hold, so you cannot give or take it.`;
}

export function childUnavailable(
  parent: Pick<Role, 'id' | 'default_for_new_subjects'>,
  child: Role,
  children: readonly Pick<Role, 'id'>[],
  caller: readonly AdminCapability[],
  tenant: string,
): string | null {
  if (child.id === parent.id) return 'this role itself';
  if (children.some((each) => each.id === child.id)) return 'nested here already';
  if (parent.default_for_new_subjects && child.admin_reach.length > 0) {
    return 'Every new subject receives this role, so it may nest no admin capability.';
  }
  return removalBlock(child, caller, tenant);
}

type RefusedProblem = Parameters<typeof writeRefusal>[0];

export function compositeRefusal(child: string, problem: RefusedProblem): string | null {
  if (problem.status === 409 && problem.detail === 'would create a role composite cycle') {
    return `Refused: ${child} already includes this role, so nesting it here would make a loop.`;
  }
  if (problem.status === 409 && problem.type === 'about:blank' && problem.detail !== undefined) {
    return `Refused: ${problem.detail}.`;
  }
  return writeRefusal(problem);
}

// What a refused nesting of the role chosen in the picker means.
export function addRefusal(problem: RefusedProblem): string | null {
  return compositeRefusal('the role chosen', problem);
}

export function compositesFixed(role: Role): string | null {
  return isBuiltin(role)
    ? `${role.name} is a capability of the built-in admin client: it keeps the roles it was provisioned with, and nothing is nested in it or taken out of it here.`
    : null;
}

export function deletionFixed(role: Role): string | null {
  return isBuiltin(role)
    ? `${role.name} is a capability of the built-in admin client, so it cannot be deleted: every administrator holding it would lose it.`
    : null;
}
