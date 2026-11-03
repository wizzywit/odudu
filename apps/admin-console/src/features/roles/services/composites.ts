import { type Role } from '@odudu/contracts/admin';
import {
  roleReachUnavailable,
  writeRefusal,
  lossText,
  type Asked,
  type Loss,
} from '#/shared/services/capabilities';
import { type AdminCapability } from '#/shared/services/principal';
import { isBuiltin } from '#/features/roles/services/roleDeletion';
import { failureTextWith } from '#/shared/services/failure';
import { type GatewayFailure } from '#/shared/services/result';

export interface Child {
  role: Role;
  // Why it cannot be taken out here, or null when it can.
  held: string | null;
}

export function childRows(
  children: readonly Role[],
  caller: readonly AdminCapability[],
  tenant: string,
): Child[] {
  return children.map((role) => ({ role, held: roleReachUnavailable(role, caller, tenant) }));
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
  return roleReachUnavailable(child, caller, tenant);
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

export function compositeRemovalConfirmation(role: string, child: string, loss: Loss): Asked {
  return {
    title: 'Take out a role your own access runs through?',
    consequence: `Whoever holds ${role} no longer holds ${child} through it.${lossText(loss, `${child} nested in ${role}`)}`,
  };
}

export function unnestedText(child: string, role: string): string {
  return `${child} is no longer nested in ${role}.`;
}

export function compositeRemovalFailureText(
  role: string,
  child: string,
  failure: GatewayFailure,
): string {
  const unconfirmed = () =>
    `Could not confirm whether ${child} was taken out. Look at the list before trying again.`;
  return failureTextWith(
    { network: unconfirmed, schema: unconfirmed, defect: unconfirmed },
    {
      name: child,
      verb: 'taken out',
      lookAt: 'the list',
      stale: `${role}'s composites changed since you opened them, so ${child} was not taken out. They have been read again; look before trying again.`,
      refused: (problem) => compositeRefusal(child, problem),
    },
  )(failure);
}
