import type { ClientScope, SetScopeRolesResponse } from '@odudu/contracts/admin';
import { withSearch } from '#/shared/service/address';
import { roleReachUnavailable } from '#/shared/service/capabilities';
import type { LeftOut, PartialCopy } from '#/shared/service/copy';
import { andList, plural } from '#/shared/service/format';
import type { AdminCapability } from '#/shared/service/principal';
import type { GatewayResult } from '#/shared/service/result';
import { scopeHref, scopesHref } from '#/features/scopes/service/address';

type MappedRole = SetScopeRolesResponse['items'][number];

export type CopyRead =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'ready'; scope: ClientScope; roles: readonly MappedRole[]; bound: readonly string[] }
  | { status: 'failed' };

export type Copying =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'failed' }
  | {
      status: 'ready';
      name: string;
      // What the copy will map and bind.
      roles: readonly string[];
      mappers: readonly string[];
      // What it will not map, since the caller could not give it, and why.
      left: readonly LeftOut[];
    };

export interface CopySource {
  scope: ClientScope;
  roles: readonly MappedRole[];
  bound: readonly string[];
}

// The scope with what it maps and binds, or nothing when any read failed.
export function copySourceOf(
  scope: GatewayResult<ClientScope>,
  roles: GatewayResult<{ items: readonly MappedRole[] }>,
  mappers: GatewayResult<{ bound: readonly string[] }>,
): CopySource | null {
  return scope.ok && roles.ok && mappers.ok
    ? { scope: scope.data, roles: roles.data.items, bound: mappers.data.bound }
    : null;
}

export interface CopyPlan {
  mapped: MappedRole[];
  left: LeftOut[];
}

export function copyHrefOf(tenant: string, id: string): string {
  return withSearch(`${scopesHref(tenant)}/new`, { copy: id });
}

// A copy maps the roles a caller could give. Until the caller is known every
// role is taken to be mappable.
export function copyPlan(
  roles: readonly MappedRole[],
  caller: readonly AdminCapability[] | undefined,
  tenant: string,
): CopyPlan {
  const plan: CopyPlan = { mapped: [], left: [] };
  for (const role of roles) {
    const why = caller === undefined ? null : roleReachUnavailable(role, caller, tenant);
    if (why === null) plan.mapped.push(role);
    else plan.left.push({ name: role.name, why });
  }
  return plan;
}

export function copyingOf(source: CopyRead, plan: CopyPlan): Copying {
  if (source.status === 'ready') {
    return {
      status: 'ready',
      name: source.scope.name,
      roles: plan.mapped.map((role) => role.name),
      mappers: source.bound,
      left: plan.left,
    };
  }
  return { status: source.status };
}

export function copyingText(copying: {
  name: string;
  roles: readonly string[];
  mappers: readonly string[];
}): string {
  const roles = copying.roles.length === 0 ? 'no role' : andList(copying.roles);
  const mappers = copying.mappers.length === 0 ? 'no mapper' : andList(copying.mappers);
  return `A copy of ${copying.name}, mapping ${roles} and binding ${mappers}.`;
}

export function sourceRoles(source: CopyRead): readonly MappedRole[] {
  return source.status === 'ready' ? source.roles : [];
}

export function sourceBound(source: CopyRead): readonly string[] {
  return source.status === 'ready' ? source.bound : [];
}

export function sourceDescription(source: CopyRead): string | null {
  return source.status === 'ready' ? source.scope.description : null;
}

function translated(map: Readonly<Record<string, string>>): boolean {
  return Object.keys(map).length > 0;
}

// The fields a copy is made with, the name aside: a null text is left out, and
// so is a translation map nobody filled.
export function copyBody(scope: ClientScope, description: string) {
  return {
    description,
    include_in_id_token: scope.include_in_id_token,
    include_in_access_token: scope.include_in_access_token,
    ...(scope.default_client_assignment === null
      ? {}
      : { default_client_assignment: scope.default_client_assignment }),
    ...(scope.consent_text === null ? {} : { consent_text: scope.consent_text }),
    ...(translated(scope.description_i18n) ? { description_i18n: scope.description_i18n } : {}),
    ...(translated(scope.consent_text_i18n) ? { consent_text_i18n: scope.consent_text_i18n } : {}),
    display_order: scope.display_order,
  };
}

// What is sent to make the scope: the copy of the source when there is one.
export function createBodyOf(name: string, description: string, source: CopyRead) {
  return source.status === 'ready'
    ? { name, ...copyBody(source.scope, description) }
    : { name, description };
}

const PARTS = { roles: 'roles', mappers: 'claim mappers' } as const;

export type CopyPart = keyof typeof PARTS;

// A copy asks for a part only when the source has something in it.
export function asksPart(wanted: readonly string[]): boolean {
  return wanted.length > 0;
}

// `written` is null when no write could be made, since the read gave no tag.
export function partMissed(part: CopyPart, written: { ok: boolean } | null): CopyPart[] {
  return written?.ok === true ? [] : [part];
}

// A copy missing some of its parts stays on the page, saying so, since a toast
// is never the only copy of something to act on.
export function partialCopy(
  tenant: string,
  scope: { id: string; name: string },
  missed: readonly (keyof typeof PARTS)[],
): PartialCopy | null {
  if (missed.length === 0) return null;
  const tabs = missed.map((part) => (part === 'roles' ? 'Roles' : 'Claim mappers'));
  return {
    text: `${scope.name} was created, but its ${andList(missed.map((part) => PARTS[part]))} could not be copied. Set them from its ${andList(tabs)} ${plural(tabs.length, 'tab', 'tabs')}.`,
    href: scopeHref(tenant, scope.id),
    name: scope.name,
  };
}
