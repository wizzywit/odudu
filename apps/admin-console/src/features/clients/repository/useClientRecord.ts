import type { Client } from '@odudu/contracts/admin';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  amendClient,
  deleteClient,
  readClient,
  type ClientChanges,
} from '#/features/clients/adapter/clients.ts';
import { clientRecord } from '#/features/clients/service';
import { useRecord, type RecordState } from '#/shared/repository/useRecord.ts';
import type { SaveInput } from '#/shared/repository/useSectionSave.ts';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

export function useClientRecord(tenant: string, id: string): RecordState<Client> {
  return useRecord({
    tenant,
    record: clientRecord(id),
    read: (gateway) => readClient(gateway, tenant, id),
  });
}

// Every list of clients, and what counts them, reads again once one changes.
export function useAfterClientChange(tenant: string) {
  const client = useQueryClient();
  return <R>(result: GatewayResult<R>): GatewayResult<R> => {
    if (result.ok) {
      for (const key of [
        ['list', tenant, 'clients'],
        ['count', tenant],
      ]) {
        client.invalidateQueries({ queryKey: key }).catch(() => undefined);
      }
    }
    return result;
  };
}

export interface DetailValues extends Readonly<Record<string, unknown>> {
  name: string;
  description: string;
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

export function useClientSaves(tenant: string, id: string) {
  const after = useAfterClientChange(tenant);
  const amend = async (gateway: Gateway, changes: ClientChanges, ifMatch: string) =>
    after(await amendClient(gateway, tenant, id, changes, ifMatch));
  return {
    details: (gateway: Gateway, { values, ifMatch }: SaveInput<DetailValues>) =>
      amend(gateway, { name: values.name, description: values.description }, ifMatch),
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

export interface ClientDeletion {
  busy: boolean;
  run: () => Promise<GatewayResult<undefined>>;
}

export function useClientDeletion(tenant: string, id: string): ClientDeletion {
  const { gateway } = useTransport();
  const after = useAfterClientChange(tenant);
  // The record's own entries are left to lapse: removing them while its page
  // is still mounted would read them again, and find nothing.
  const mutation = useMutation({
    mutationFn: async () => after(await deleteClient(gateway, tenant, id)),
  });
  return { busy: mutation.isPending, run: () => mutation.mutateAsync() };
}
