import type { ListFlowsResponse } from '#/entities/flow/types/flow';
import { useFlowsRead } from '#/entities/flow/repository/useFlowsRead';
import type { RecordState } from '#/shared/lib/repository/useRecord';

export function useFlowsRecord(tenant: string): RecordState<ListFlowsResponse> {
  return useFlowsRead(tenant);
}
