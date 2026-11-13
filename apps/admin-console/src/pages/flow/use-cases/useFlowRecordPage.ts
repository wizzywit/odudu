import type { Area } from '#/entities/area';
import type { FlowWire, ListFlowsResponse } from '#/pages/flow/types/flows';
import { useFlowById, useFlowsRecord } from '#/pages/flow/repository/useFlows';
import { flowArea } from '#/pages/flow/services/flowWording';
import { flowTrail } from '#/pages/flow/services/flows';
import { FLOWS_WORDS, type FlowsWords } from '#/pages/flow/services/flowsWords';
import type { Crumb } from '#/shared/lib/services/breadcrumb';
import type { RecordState } from '#/shared/lib/repository/useRecord';

export interface FlowRecordPage {
  words: FlowsWords['record'];
  listWords: FlowsWords['list'];
  record: RecordState<FlowWire>;
  // The list read the authenticators a step may name come from.
  flows: RecordState<ListFlowsResponse>;
  trail: readonly Crumb[];
  title: string;
}

export function useFlowRecordPage(tenant: string, id: string): FlowRecordPage {
  const record = useFlowById(tenant, id);
  const flows = useFlowsRecord(tenant);
  const title = record.data?.name ?? FLOWS_WORDS.record.title;
  return {
    words: FLOWS_WORDS.record,
    listWords: FLOWS_WORDS.list,
    record,
    flows,
    trail: flowTrail(tenant, title),
    title,
  };
}

// The gate wraps the page, so it takes the area, the title and the way back here.
export function useFlowRecordArea(tenant: string): {
  area: Area;
  title: string;
  trail: readonly Crumb[];
} {
  const { area } = flowArea();
  return {
    area,
    title: FLOWS_WORDS.record.title,
    trail: flowTrail(tenant, FLOWS_WORDS.record.title),
  };
}
