import type { FlowWire, ListFlowsResponse, SaveFlowRequest } from '#/pages/flow/types/flows';
import {
  createFlow,
  deleteFlow,
  findFlow,
  readFlowById,
  readFlows,
  replaceFlowById,
} from '#/pages/flow/adapter/flows';
import { flowRecordName, FLOWS_RECORD } from '#/pages/flow/services/flows';
import type { Step } from '#/pages/flow/services/steps';
import { findKey } from '#/shared/lib/repository/queryKeys';
import { useFreshRead } from '#/shared/lib/repository/useFreshRead';
import { useAfterChange } from '#/shared/lib/repository/useAfterChange';
import { useRecord, type RecordState } from '#/shared/lib/repository/useRecord';
import type { SaveInput } from '#/shared/lib/repository/useSectionSave';
import { useWrite, type Write } from '#/shared/lib/repository/useWrite';
import type { Gateway, GatewayResult } from '#/shared/api/transport/gateway';
import { useTransport } from '#/shared/api/transport/useTransport';

export function useFlowsRecord(tenant: string): RecordState<ListFlowsResponse> {
  return useRecord({
    tenant,
    record: FLOWS_RECORD,
    read: (gateway) => readFlows(gateway, tenant),
  });
}

export function useFlowById(tenant: string, id: string): RecordState<FlowWire> {
  return useRecord({
    tenant,
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

export function useDeleteFlow(tenant: string): Write<string, GatewayResult<undefined>> {
  const after = useAfterFlowsChange(tenant, null, FLOWS_ONLY);
  return useWrite({
    send: async (gateway, id: string) => after(await deleteFlow(gateway, tenant, id)),
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
    after(
      await replaceFlowById(
        gateway,
        tenant,
        id,
        { name: values.name.trim(), steps: [...values.steps] },
        ifMatch,
      ),
    );
}

// The default flow's steps are edited on the sign-in flow's own record too, and
// the flows list shows them.
export function useAfterDefaultSave(tenant: string) {
  return useAfterFlowsChange(tenant, null, FLOWS_ONLY);
}
