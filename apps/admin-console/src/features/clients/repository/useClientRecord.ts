import type { ClientRecord } from '@odudu/contracts/admin';
import {
  amendClient,
  deleteClient,
  readClient,
  type ClientChanges,
} from '#/features/clients/adapter/clients';
import { clientRecord, translationsPatch } from '#/features/clients/service';
import type { Translations } from '#/shared/service/localised';
import { countKey, listKey, recordKey, scopeClientsKey } from '#/shared/repository/queryKeys';
import { rolesGoneReach } from '#/shared/repository/rolesGoneReach';
import { useAfterChange } from '#/shared/repository/useAfterChange';
import { useInvalidate } from '#/shared/repository/useInvalidate';
import { useRecord, type RecordState } from '#/shared/repository/useRecord';
import type { SaveInput } from '#/shared/repository/useSectionSave';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway';
import { useWrite, type Write } from '#/shared/repository/useWrite';

export function useClientRecord(tenant: string, id: string): RecordState<ClientRecord> {
  return useRecord({
    tenant,
    record: clientRecord(id),
    read: (gateway) => readClient(gateway, tenant, id),
  });
}

// Read the record again now rather than at the next refetch.
export function useRereadClient(tenant: string, id: string): () => void {
  const { invalidateExact } = useInvalidate();
  return () => {
    invalidateExact(recordKey(tenant, clientRecord(id)));
  };
}

// Every list of clients, and what counts them, reads again once one changes.
export function useAfterClientChange(tenant: string) {
  const { invalidate } = useInvalidate();
  return <R>(result: GatewayResult<R>): GatewayResult<R> => {
    if (result.ok) invalidate(listKey(tenant, 'clients'), countKey(tenant));
    return result;
  };
}

export interface DetailValues extends Readonly<Record<string, unknown>> {
  name: string;
  description: string;
}

export interface TranslationSectionValues extends Readonly<Record<string, unknown>> {
  name_i18n: Translations;
  description_i18n: Translations;
}

export interface PageValues extends Readonly<Record<string, unknown>> {
  client_uri: string;
  policy_uri: string;
  tos_uri: string;
}

export interface EnabledValues extends Readonly<Record<string, unknown>> {
  enabled: boolean;
}

export interface ConsentValues extends Readonly<Record<string, unknown>> {
  consent_required: boolean;
}

export interface RedirectValues extends Readonly<Record<string, unknown>> {
  redirect_uris: readonly string[];
}

export interface OriginValues extends Readonly<Record<string, unknown>> {
  web_origins: readonly string[];
}

// One amendment of the client, sent on the ETag the section read.
export function useAmendClient(tenant: string, id: string) {
  const after = useAfterClientChange(tenant);
  return async (gateway: Gateway, changes: ClientChanges, ifMatch: string) =>
    after(await amendClient(gateway, tenant, id, changes, ifMatch));
}

export function useClientSaves(tenant: string, id: string) {
  const amend = useAmendClient(tenant, id);
  return {
    details: (gateway: Gateway, { values, ifMatch }: SaveInput<DetailValues>) =>
      amend(gateway, { name: values.name, description: values.description }, ifMatch),
    translations: (gateway: Gateway, { changes, ifMatch }: SaveInput<TranslationSectionValues>) =>
      amend(gateway, translationsPatch(changes), ifMatch),
    pages: (gateway: Gateway, { values, ifMatch }: SaveInput<PageValues>) =>
      amend(
        gateway,
        { client_uri: values.client_uri, policy_uri: values.policy_uri, tos_uri: values.tos_uri },
        ifMatch,
      ),
    availability: (gateway: Gateway, { values, ifMatch }: SaveInput<EnabledValues>) =>
      amend(gateway, { enabled: values.enabled }, ifMatch),
    consent: (gateway: Gateway, { values, ifMatch }: SaveInput<ConsentValues>) =>
      amend(gateway, { consent_required: values.consent_required }, ifMatch),
    redirects: (gateway: Gateway, { values, ifMatch }: SaveInput<RedirectValues>) =>
      amend(gateway, { redirect_uris: values.redirect_uris }, ifMatch),
    origins: (gateway: Gateway, { values, ifMatch }: SaveInput<OriginValues>) =>
      amend(gateway, { web_origins: values.web_origins }, ifMatch),
  };
}

export function useClientDeletion(
  tenant: string,
  id: string,
): Write<void, GatewayResult<undefined>> {
  const reach = rolesGoneReach(tenant);
  // Its roles, scope assignments, consents and grants go with it. The
  // record's own entries are left to lapse: removing them while its page is
  // still mounted would read them again, and find nothing.
  const after = useAfterChange(tenant, id, {
    ...reach,
    recordOf: clientRecord,
    keys: [...reach.keys, countKey(tenant), scopeClientsKey(tenant)],
  });
  return useWrite({
    send: async (gateway) => after(await deleteClient(gateway, tenant, id)),
  });
}
