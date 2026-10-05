import type {
  EffectiveRoleAssignment,
  ListRoleCompositesResponse,
  Role,
} from '@odudu/contracts/admin';
import type { Crumb } from '#/shared/service/breadcrumb.ts';
import {
  ADMIN_CLIENT_KEY,
  adminLoss,
  beyondCaller,
  ceilingOf,
  isAdminRole,
  isHolding,
  lossText,
  type Loss,
  writeRefusal,
} from '#/shared/service/capabilities.ts';
import { writeFailureText } from '#/shared/service/failure.ts';
import { andList } from '#/shared/service/format.ts';
import type { AdminCapability, Authority } from '#/shared/service/principal.ts';
import type { GatewayFailure } from '#/shared/service/result.ts';

export type { Role };

export function rolesHref(tenant: string): string {
  return `/console/${encodeURIComponent(tenant)}/roles`;
}

export function newRoleHref(tenant: string): string {
  return `${rolesHref(tenant)}/new`;
}

export function copyHref(tenant: string, id: string): string {
  return `${newRoleHref(tenant)}?copy=${encodeURIComponent(id)}`;
}

export function roleHref(tenant: string, id: string): string {
  return `${rolesHref(tenant)}/${encodeURIComponent(id)}`;
}

// The rail group is a heading, not a page, so it has no address.
export function rolesTrail(tenant: string, current: string): readonly Crumb[] {
  return [{ label: 'Identity' }, { label: 'Roles', href: rolesHref(tenant) }, { label: current }];
}

export const ROLE_TABS = ['general', 'composites', 'members', 'activity'] as const;
export type RoleTab = (typeof ROLE_TABS)[number];

export const ROLE_TAB_LABELS: Readonly<Record<RoleTab, string>> = {
  general: 'General',
  composites: 'Composites',
  members: 'Members',
  activity: 'Activity',
};

export function roleRecord(id: string): string {
  return `roles/${id}`;
}

export function compositesRecord(id: string): string {
  return `roles/${id}/composites`;
}

// The records whose sections each tab edits, so its dot follows them.
export const TAB_RECORDS: Readonly<Record<RoleTab, (id: string) => readonly string[]>> = {
  general: (id) => [roleRecord(id)],
  composites: (id) => [compositesRecord(id)],
  members: () => [],
  activity: () => [],
};

// ADR 0039: a token's roles claim carries the name.
export const NAME_FIXED =
  "A role's name is fixed once it is made: tokens carry it in their roles claim, and a relying party that matches on it would otherwise pass or fail by a token's age. A tenant role can be copied under another name instead.";

export { DESCRIPTION_MAX } from '@odudu/contracts/admin';

export const DESCRIPTION_RULE = 'Leave it empty for none.';

export const NAME_TAKEN = 'That name is taken';
export const DEFAULT_LABEL = 'Given to every new subject';
export const ADD_LABEL = 'Add a composite';
export const NEST_LABEL = 'Role to nest';

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

export type RoleChange =
  { kind: 'delete'; id: string } | { kind: 'remove'; id: string; child: string };

// What a principal holding `own` stops holding: a deleted role takes itself
// and everything held only within it, and an edge what it alone carried.
export function roleSelfLoss(
  own: readonly EffectiveRoleAssignment[],
  change: RoleChange,
): string[] {
  switch (change.kind) {
    case 'delete':
      return adminLoss(own, (_via, role) => role.id === change.id);
    case 'remove':
      return adminLoss(
        own,
        (via, role) =>
          role.id === change.child && via.kind === 'composite' && via.parent_role_id === change.id,
      );
  }
}

export interface Asked {
  title: string;
  consequence: string;
}

// What the role reaches, which its record carries, and the caller's own
// capabilities: every ceiling on its writes is judged by both, so nothing is
// offered until whoami has answered.
export type Ceiling =
  | { status: 'checking' }
  | {
      status: 'ready';
      caller: readonly AdminCapability[];
      // Why it cannot be deleted, by the ceiling, or null.
      deleteHeld: string | null;
    };

export function roleCeiling(role: Role | undefined, authority: Authority | undefined): Ceiling {
  if (authority === undefined || role === undefined) return { status: 'checking' };
  return {
    status: 'ready',
    caller: authority.capabilities,
    deleteHeld: isBuiltin(role) ? null : deleteBlock(role, authority.capabilities),
  };
}

// Left out by the ceiling, which the page's one line explains.
export function isDeleteHeld(ceiling: Ceiling): boolean {
  return ceiling.status === 'ready' && ceiling.deleteHeld !== null;
}

export function defaultsChecking(role: Role, ceiling: Ceiling): boolean {
  return ceiling.status !== 'ready' && !isBuiltin(role);
}

// A copy is a tenant role, so only a tenant role offers one.
export function copyHrefOf(tenant: string, role: Role | undefined): string | null {
  return role?.client_id === null ? copyHref(tenant, role.id) : null;
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

// Each removal asks first where it takes from yourself, so none is offered
// while that is still being read.
export function compositesOffered(ceiling: Ceiling, own: { status: string }): boolean {
  return ceiling.status === 'ready' && own.status !== 'loading';
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
  if (failure.kind !== 'problem') {
    return `Could not confirm whether ${child} was taken out. Look at the list before trying again.`;
  }
  return writeFailureText(failure, {
    name: child,
    verb: 'taken out',
    lookAt: 'the list',
    stale: `${role}'s composites changed since you opened them, so ${child} was not taken out. They have been read again; look before trying again.`,
    refused: (problem) => compositeRefusal(child, problem),
  });
}

export function roleDeleteConsequence(name: string, loss: Loss): string {
  return `${name} is taken from every subject, group and scope it is given to, and out of every role it is nested in; what it nests is no longer held through it. It cannot be undone.${lossText(loss, name)}`;
}

export function roleDeleteFailureText(name: string, failure: GatewayFailure): string {
  return writeFailureText(failure, {
    name,
    verb: 'deleted',
    lookAt: 'the roles',
    refused: (problem) =>
      problem.status === 409 && problem.detail !== undefined
        ? `Refused: ${problem.detail}.`
        : writeRefusal(problem),
  });
}

export type CopyRead =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'ready'; role: Role; children: ListRoleCompositesResponse['items'] }
  | { status: 'failed' };

export type Copying =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'failed' }
  | {
      status: 'ready';
      name: string;
      // What the copy will nest.
      children: readonly string[];
      // What it will not, since the caller could not nest it, and why.
      left: readonly { name: string; why: string }[];
    };

export interface PartialCopy {
  text: string;
  href: string;
  name: string;
}

export interface CopyPlan {
  nested: Role[];
  left: { name: string; why: string }[];
}

// A copy is a new tenant role, nested in nothing and handed to nobody yet,
// so each child is judged as a nesting into one. Until the caller is known
// every child is taken to be nestable.
export function copyPlan(
  children: readonly Role[],
  caller: readonly AdminCapability[] | undefined,
  tenant: string,
): CopyPlan {
  const fresh = { id: '', default_for_new_subjects: false };
  const plan: CopyPlan = { nested: [], left: [] };
  for (const child of children) {
    const why = caller === undefined ? null : childUnavailable(fresh, child, [], caller, tenant);
    if (why === null) plan.nested.push(child);
    else plan.left.push({ name: child.name, why });
  }
  return plan;
}

export function copyingOf(source: CopyRead, plan: CopyPlan): Copying {
  if (source.status === 'ready') {
    return {
      status: 'ready',
      name: source.role.name,
      children: plan.nested.map((child) => child.name),
      left: plan.left,
    };
  }
  return { status: source.status };
}

export function copyingText(copying: { name: string; children: readonly string[] }): string {
  const nests = copying.children.length === 0 ? 'nothing' : andList(copying.children);
  return `A copy of ${copying.name}, nesting ${nests}.`;
}

export function copiedDescription(edited: string | null, source: CopyRead): string {
  return edited ?? (source.status === 'ready' ? (source.role.description ?? '') : '');
}

// A copy missing some of its composites stays on the page, saying so, since
// a toast is never the only copy of something to act on.
export function partialCopy(
  tenant: string,
  role: Pick<Role, 'id' | 'name'>,
  missed: readonly Pick<Role, 'name'>[],
): PartialCopy | null {
  if (missed.length === 0) return null;
  return {
    text: `${role.name} was created, but ${andList(missed.map((each) => each.name))} could not be nested in it. Add them from its Composites tab.`,
    href: `${roleHref(tenant, role.id)}?tab=composites`,
    name: role.name,
  };
}
