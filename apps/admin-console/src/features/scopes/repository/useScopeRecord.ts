import type {
  ClientScope,
  ListBuiltinScopesResponse,
  RestoreBuiltinScopesResponse,
  ScopeImpact,
  ScopeMappers,
  SetScopeRolesResponse,
} from '@odudu/contracts/admin';
import {
  amendScope,
  deleteScope,
  readBuiltinScopes,
  readScope,
  readScopeImpact,
  readScopeMappers,
  readScopeRoles,
  restoreBuiltinScopes,
  setScopeMappers,
  setScopeRoles,
} from '#/features/scopes/adapter/scopes';
import {
  generalPatch,
  scopeMappersRecord,
  scopeRecord,
  scopeRolesRecord,
  type GeneralValues,
} from '#/features/scopes/service';
import { uniqueIds } from '#/shared/service/ids';
import {
  builtinScopesKey,
  countKey,
  listKey,
  pickerKey,
  scopeImpactKey,
} from '#/shared/repository/queryKeys';
import { useAfterChange } from '#/shared/repository/useAfterChange';
import { useRead } from '#/shared/repository/useRead';
import { useRecord, type RecordState } from '#/shared/repository/useRecord';
import type { Read } from '#/shared/service/read';
import { useTransport } from '#/shared/transport/useTransport';
import type { SaveInput } from '#/shared/repository/useSectionSave';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway';
import { useWrite, type Write } from '#/shared/repository/useWrite';
import type { Translations } from '#/shared/service/localised';
import type { DescriptionValues, RoleValues } from '#/shared/service/sectionValues';

export function useScopeRecord(tenant: string, id: string): RecordState<ClientScope> {
  return useRecord({
    tenant,
    record: scopeRecord(id),
    read: (gateway) => readScope(gateway, tenant, id),
  });
}

export function useScopeRolesRecord(
  tenant: string,
  id: string,
): RecordState<SetScopeRolesResponse> {
  return useRecord({
    tenant,
    record: scopeRolesRecord(id),
    read: (gateway) => readScopeRoles(gateway, tenant, id),
  });
}

export function useScopeMappersRecord(
  tenant: string,
  id: string,
  enabled = true,
): RecordState<ScopeMappers> {
  return useRecord({
    tenant,
    enabled,
    record: scopeMappersRecord(id),
    read: (gateway) => readScopeMappers(gateway, tenant, id),
  });
}

// A scope's change is read again by the lists and pickers that show it, and
// by its own records, except those of a deleted scope, which would only find
// it gone. A deleted scope also leaves every
// client it was assigned to; those clients' pages are not open here, so what
// the console holds of them is dropped, not marked stale.
function useAfterScopeChange(tenant: string, deleted: string | null = null) {
  return useAfterChange(tenant, deleted, {
    kinds: [],
    records: ['scopes/'],
    recordOf: scopeRecord,
    dropped: ['clients/'],
    keys: [
      listKey(tenant, 'scopes'),
      countKey(tenant, 'scopes'),
      pickerKey(tenant, 'scopes'),
      builtinScopesKey(tenant),
    ],
  });
}

export interface TokenValues extends Readonly<Record<string, unknown>> {
  include_in_id_token: boolean;
  include_in_access_token: boolean;
}

export interface AssignmentValues extends Readonly<Record<string, unknown>> {
  default_client_assignment: string;
}

export interface ConsentValues extends Readonly<Record<string, unknown>> {
  consent_text: string;
  display_order: string;
  consent_text_i18n: Translations;
}

export interface DescriptionSectionValues extends DescriptionValues {
  description_i18n: Translations;
}

export interface MapperValues extends Readonly<Record<string, unknown>> {
  mapper_names: readonly string[];
}

export function useScopeSaves(tenant: string, id: string) {
  const after = useAfterScopeChange(tenant);
  return {
    general: async (
      gateway: Gateway,
      { changes, ifMatch }: { changes: GeneralValues; ifMatch: string },
    ) => after(await amendScope(gateway, tenant, id, generalPatch(changes), ifMatch)),
    roles: async (gateway: Gateway, { values, ifMatch }: SaveInput<RoleValues>) =>
      after(await setScopeRoles(gateway, tenant, id, uniqueIds(values.role_ids), ifMatch)),
    mappers: async (gateway: Gateway, { values, ifMatch }: SaveInput<MapperValues>) =>
      after(await setScopeMappers(gateway, tenant, id, values.mapper_names, ifMatch)),
  };
}

// `confirm` is the scope's name, which the server asks of a built-in scope
// and ignores for any other.
export function useScopeDeletion(
  tenant: string,
  id: string,
  confirm?: string,
): Write<void, GatewayResult<undefined>> {
  const after = useAfterScopeChange(tenant, id);
  return useWrite({
    send: async (gateway) => after(await deleteScope(gateway, tenant, id, confirm)),
  });
}

// Read again each time it is asked for: the counts move with every assignment.
export function useScopeImpact(tenant: string, id: string, asked: boolean): Read<ScopeImpact> {
  const { gateway } = useTransport();
  return useRead(scopeImpactKey(tenant, id), asked, () => readScopeImpact(gateway, tenant, id));
}

export function useBuiltinScopes(tenant: string, asked: boolean): Read<ListBuiltinScopesResponse> {
  const { gateway } = useTransport();
  return useRead(builtinScopesKey(tenant), asked, () => readBuiltinScopes(gateway, tenant));
}

export function useRestoreBuiltins(
  tenant: string,
): Write<void, GatewayResult<RestoreBuiltinScopesResponse>> {
  const after = useAfterScopeChange(tenant);
  return useWrite({
    send: async (gateway) => after(await restoreBuiltinScopes(gateway, tenant)),
  });
}
