import type {
  AdminCapabilitiesResponse,
  CountResponse,
  EffectiveRoleAssignment,
  RequiredAction,
  SetRequiredActionsResponse,
  SetRolesResponse,
  SetSubjectGroupsResponse,
} from '@odudu/contracts/admin';
import {
  readAdminCapabilities,
  readAdminRoles,
  readEffectiveRoles,
  readRequiredActions,
  readSubjectGroups,
  setRequiredActions,
  setSubjectGroups,
} from '#/features/subjects/adapter/access';
import { readSubjectCount } from '#/features/subjects/adapter/subjects';
import {
  adminRolesKey,
  heldCapabilitiesKey,
  holdersKey,
  listKey,
  membershipsKey,
} from '#/shared/repository/queryKeys';
import { useInvalidate } from '#/shared/repository/useInvalidate';
import { useRead } from '#/shared/repository/useRead';
import type { Read } from '#/shared/services/read';
import { actionsRecord, groupsRecord, rolesRecord } from '#/features/subjects/services';
import { readSubjectRoles, setSubjectRoles } from '#/shared/adapter/administrators';
import { useRecord, type RecordState } from '#/shared/repository/useRecord';
import { useResourceList } from '#/shared/repository/useResourceList';
import type { SaveInput } from '#/shared/repository/useSectionSave';
import type { Holding } from '#/shared/services/capabilities';
import { uniqueIds } from '#/shared/services/ids';
import type { ResourceListState } from '#/shared/services/resourceList';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway';
import { useTransport } from '#/shared/transport/useTransport';

export function useGroupsRecord(tenant: string, id: string): RecordState<SetSubjectGroupsResponse> {
  return useRecord({
    tenant,
    record: groupsRecord(id),
    read: (gateway) => readSubjectGroups(gateway, tenant, id),
  });
}

export function useRolesRecord(tenant: string, id: string): RecordState<SetRolesResponse> {
  return useRecord({
    tenant,
    record: rolesRecord(id),
    read: (gateway) => readSubjectRoles(gateway, tenant, id),
  });
}

export function useActionsRecord(
  tenant: string,
  id: string,
): RecordState<SetRequiredActionsResponse> {
  return useRecord({
    tenant,
    record: actionsRecord(id),
    read: (gateway) => readRequiredActions(gateway, tenant, id),
  });
}

function effectiveRolesResource(id: string): string {
  return `subjects/${id}/heldRoles`;
}

// The admin capabilities a subject holds, whole: every judgement of what it
// may be given or refused is made from this, never from a page of its roles.
export function useHeldCapabilities(
  tenant: string,
  id: string,
  asked = true,
): Read<AdminCapabilitiesResponse> {
  const { gateway } = useTransport();
  return useRead(heldCapabilitiesKey(tenant, id), asked, () =>
    readAdminCapabilities(gateway, tenant, id),
  );
}

// Every role a subject holds, for reading: a page at a time, "Load more" for the rest.
export function useEffectiveRoleList(
  tenant: string,
  id: string,
): ResourceListState<EffectiveRoleAssignment> {
  return useResourceList({
    tenant,
    resource: effectiveRolesResource(id),
    read: (gateway, query) => readEffectiveRoles(gateway, tenant, id, query),
  });
}

// A subject's own memberships, read only where asked: the principal's, to
// say exactly what a write to a group would take from it.
export function useMemberships(
  tenant: string,
  id: string,
  asked: boolean,
): Read<SetSubjectGroupsResponse> {
  const { gateway } = useTransport();
  return useRead(membershipsKey(tenant, id), asked, () => readSubjectGroups(gateway, tenant, id));
}

export function useAdminRoleIds(tenant: string): Read<ReadonlyMap<Holding, string>> {
  const { gateway } = useTransport();
  return useRead(adminRolesKey(tenant), true, () => readAdminRoles(gateway, tenant));
}

// How many enabled subjects hold what the last-administrator guard counts.
export function useEnabledHolderCount(tenant: string, counted: string): Read<CountResponse> {
  const { gateway } = useTransport();
  return useRead(holdersKey(tenant, 'enabled', counted), true, () =>
    readSubjectCount(
      gateway,
      tenant,
      new URLSearchParams({ capability: counted, enabled: 'true' }),
    ),
  );
}

// What follows from a subject's roles and groups is read again once either
// changes: what it holds, and every list that counts holders.
function useAfterAccessChange(tenant: string, id: string) {
  const { invalidate } = useInvalidate();
  return <R>(result: GatewayResult<R>): GatewayResult<R> => {
    if (result.ok) {
      invalidate(
        heldCapabilitiesKey(tenant, id),
        membershipsKey(tenant, id),
        holdersKey(tenant),
        listKey(tenant),
      );
    }
    return result;
  };
}

export interface GroupValues extends Readonly<Record<string, unknown>> {
  group_ids: readonly string[];
}

export function useSaveGroups(tenant: string, id: string) {
  const after = useAfterAccessChange(tenant, id);
  return async (gateway: Gateway, { values, ifMatch }: SaveInput<GroupValues>) =>
    after(await setSubjectGroups(gateway, tenant, id, values.group_ids, ifMatch));
}

// Both sections of the Roles tab replace one list: each sends its own part
// with the other part as the record holds it.
export function useSaveRoles(tenant: string, id: string) {
  const after = useAfterAccessChange(tenant, id);
  return async (gateway: Gateway, roleIds: readonly string[], ifMatch: string) =>
    after(await setSubjectRoles(gateway, tenant, id, uniqueIds(roleIds), ifMatch));
}

export interface ActionValues extends Readonly<Record<string, unknown>> {
  actions: readonly RequiredAction[];
}

export function saveActions(tenant: string, id: string) {
  return (gateway: Gateway, { values, ifMatch }: SaveInput<ActionValues>) =>
    setRequiredActions(gateway, tenant, id, values.actions, ifMatch);
}
