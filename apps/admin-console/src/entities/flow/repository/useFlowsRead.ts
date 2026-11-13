import type { ListFlowsResponse } from '#/entities/flow/types/flow';
import { readFlows } from '#/entities/flow/adapter/flows';
import { FLOWS_RECORD } from '#/entities/flow/services/flowRecord';
import { useRecord, type RecordState } from '#/shared/lib/repository/useRecord';

export function useFlowsRead(tenant: string): RecordState<ListFlowsResponse> {
  return useRecord({
    tenant,
    record: FLOWS_RECORD,
    read: (gateway) => readFlows(gateway, tenant),
  });
}
