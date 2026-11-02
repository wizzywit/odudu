import type { ListExecutionsResponse } from '@odudu/contracts/admin';
import { useFlowRecord } from '#/features/flow/repository/useFlowRecord';
import type { RecordState } from '#/shared/repository/useRecord';

export function useFlowRead(tenant: string): RecordState<ListExecutionsResponse> {
  return useFlowRecord(tenant);
}
