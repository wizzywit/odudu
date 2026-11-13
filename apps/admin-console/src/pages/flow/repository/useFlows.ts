import { flowRecordName, FLOWS_RECORD, readFlows, useFlowsRecord } from '#/entities/flow';
import type { FlowWire, SaveFlowRequest } from '#/pages/flow/types/flows';
import {
  createFlow,
  deleteFlow,
  makeFlowDefault,
  readFlowById,
  replaceFlowById,
} from '#/pages/flow/adapter/flows';
import { flowSaveRequest } from '#/pages/flow/services/flows';
import type { Step } from '#/pages/flow/services/steps';
import { findKey, recordKey } from '#/shared/lib/repository/queryKeys';
import { isStale } from '#/shared/lib/services/failure';
import { useInvalidate } from '#/shared/lib/repository/useInvalidate';
import { useFreshRead } from '#/shared/lib/repository/useFreshRead';
import { useAfterChange } from '#/shared/lib/repository/useAfterChange';
import { useRecord, type RecordState } from '#/shared/lib/repository/useRecord';
import type { SaveInput } from '#/shared/lib/repository/useSectionSave';
import { useWrite, type Write } from '#/shared/lib/repository/useWrite';
import type { Gateway, GatewayResult } from '#/shared/api/transport/gateway';
import { useTransport } from '#/shared/api/transport/useTransport';

export { useFlowsRecord };

// For a creation whose answer was lost: the flow of that name, if the tenant has it.
async function findFlow(
  gateway: Gateway,
  tenant: string,
  name: string,
): Promise<GatewayResult<FlowWire | null>> {
  const result = await readFlows(gateway, tenant);
  if (!result.ok) return result;
  return { ...result, data: result.data.items.find((flow) => flow.name === name) ?? null };
}

export function useFlowById(tenant: string, id: string, enabled = true): RecordState<FlowWire> {
  return useRecord({
    tenant,
    enabled,
    record: flowRecordName(id),
    read: (gateway) => readFlowById(gateway, tenant, id),
  });
}

// The record prefixes a change reads again: the list and each flow's own, and for a change
// that may reach the default flow also the sign-in flow's record, which shares the `flow` prefix.
const FLOWS_ONLY: readonly string[] = [FLOWS_RECORD];
const WITH_DEFAULT: readonly string[] = ['flow'];

function useAfterFlowsChange(tenant: string, deleted: string | null, records: readonly string[]) {
  return useAfterChange(tenant, deleted, {
    kinds: [],
    records,
    recordOf: flowRecordName,
    keys: [],
  });
}

export interface CreateFlow {
  busy: boolean;
  create: (body: SaveFlowRequest) => Promise<GatewayResult<FlowWire>>;
  // For a creation whose answer was lost: never sent twice, looked for instead.
  find: (name: string) => Promise<GatewayResult<FlowWire | null>>;
}

export function useCreateFlow(tenant: string): CreateFlow {
  const { gateway } = useTransport();
  const after = useAfterFlowsChange(tenant, null, FLOWS_ONLY);
  const create = useWrite({
    send: async (gateway, body: SaveFlowRequest) => after(await createFlow(gateway, tenant, body)),
  });
  const fresh = useFreshRead();
  return {
    busy: create.busy || fresh.pending,
    create: create.run,
    find: (name) =>
      fresh.read(findKey(tenant, 'flows', name), () => findFlow(gateway, tenant, name)),
  };
}

// A change to a flow names the version it was confirmed against.
export interface Confirmed {
  id: string;
  ifMatch: string;
}

// A change refused because the flow moved on reads it again, so the confirmation
// names the version that is there now.
function useRereadWhenStale(tenant: string) {
  const { invalidateExact } = useInvalidate();
  return <R>(id: string, result: GatewayResult<R>): GatewayResult<R> => {
    if (isStale(result)) invalidateExact(recordKey(tenant, flowRecordName(id)));
    return result;
  };
}

export function useDeleteFlow(tenant: string): Write<Confirmed, GatewayResult<undefined>> {
  const after = useAfterFlowsChange(tenant, null, FLOWS_ONLY);
  const reread = useRereadWhenStale(tenant);
  return useWrite({
    send: async (gateway, { id, ifMatch }: Confirmed) =>
      after(reread(id, await deleteFlow(gateway, tenant, id, ifMatch))),
  });
}

export interface FlowValues extends Readonly<Record<string, unknown>> {
  name: string;
  steps: readonly Step[];
}

// The flow's name and steps replace its own, so the list and the sign-in
// flow's record, which may be this one, are read again.
export function useFlowSave(tenant: string, id: string) {
  const after = useAfterFlowsChange(tenant, null, WITH_DEFAULT);
  return async (
    gateway: Gateway,
    { values, ifMatch }: SaveInput<FlowValues>,
  ): Promise<GatewayResult<FlowWire>> =>
    after(await replaceFlowById(gateway, tenant, id, flowSaveRequest(values), ifMatch));
}

// The default flow's steps are edited on the sign-in flow's own record too, and
// the flows list shows them.
export function useAfterDefaultSave(tenant: string) {
  return useAfterFlowsChange(tenant, null, FLOWS_ONLY);
}

export function useMakeFlowDefault(tenant: string): Write<Confirmed, GatewayResult<FlowWire>> {
  const after = useAfterFlowsChange(tenant, null, WITH_DEFAULT);
  const reread = useRereadWhenStale(tenant);
  return useWrite({
    send: async (gateway, { id, ifMatch }: Confirmed) =>
      after(reread(id, await makeFlowDefault(gateway, tenant, id, ifMatch))),
  });
}
