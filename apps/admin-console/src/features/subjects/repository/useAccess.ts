import type {
  CountResponse,
  ListEffectiveRolesResponse,
  RequiredAction,
  SetRequiredActionsResponse,
  SetRolesResponse,
  SetSubjectGroupsResponse,
} from '@odudu/contracts/admin';
import { useQueryClient } from '@tanstack/react-query';
import {
  readAdminRoles,
  readEffectiveRoles,
  readRequiredActions,
  readSubjectGroups,
  setRequiredActions,
  setSubjectGroups,
} from '#/features/subjects/adapter/access.ts';
import { readSubjectCount } from '#/features/subjects/adapter/subjects.ts';
import { useSubjectRead, type Read } from '#/features/subjects/repository/useSubjectRead.ts';
import { actionsRecord, groupsRecord, rolesRecord } from '#/features/subjects/service';
import { readSubjectRoles, setSubjectRoles } from '#/shared/adapter/administrators.ts';
import { useRecord, type RecordState } from '#/shared/repository/useRecord.ts';
import type { SaveInput } from '#/shared/repository/useSectionSave.ts';
import type { Holding } from '#/shared/service/capabilities.ts';
import { uniqueIds } from '#/shared/service/ids.ts';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

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

function effectiveKey(tenant: string, id: string) {
  return ['effective-roles', tenant, id] as const;
}

export function useEffectiveRoles(
  tenant: string,
  id: string,
  asked = true,
): Read<ListEffectiveRolesResponse> {
  const { gateway } = useTransport();
  return useSubjectRead(effectiveKey(tenant, id), asked, () =>
    readEffectiveRoles(gateway, tenant, id),
  );
}

// A subject's own memberships, read only where asked: the principal's, to
// say exactly what a write to a group would take from it.
export function useMemberships(
  tenant: string,
  id: string,
  asked: boolean,
): Read<SetSubjectGroupsResponse> {
  const { gateway } = useTransport();
  return useSubjectRead(['memberships', tenant, id], asked, () =>
    readSubjectGroups(gateway, tenant, id),
  );
}

export function useAdminRoleIds(tenant: string): Read<ReadonlyMap<Holding, string>> {
  const { gateway } = useTransport();
  return useSubjectRead(['admin-roles', tenant], true, () => readAdminRoles(gateway, tenant));
}

// How many enabled subjects hold what the last-administrator guard counts.
export function useEnabledHolderCount(tenant: string, counted: string): Read<CountResponse> {
  const { gateway } = useTransport();
  return useSubjectRead(['holders', tenant, 'enabled', counted], true, () =>
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
  const client = useQueryClient();
  return <R>(result: GatewayResult<R>): GatewayResult<R> => {
    if (result.ok) {
      for (const key of [
        effectiveKey(tenant, id),
        ['memberships', tenant, id],
        ['holders', tenant],
        ['list', tenant],
      ]) {
        client.invalidateQueries({ queryKey: key }).catch(() => undefined);
      }
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
