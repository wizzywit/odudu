import type { FlowWire } from '#/entities/flow/types/flow';
import { useFlowLookupRead } from '#/entities/flow/repository/useFlowLookup';
import type { GatewayResult } from '#/shared/lib/services/result';

export function useFlowLookup(): (
  tenant: string,
  name: string,
) => Promise<GatewayResult<FlowWire | null>> {
  return useFlowLookupRead();
}
