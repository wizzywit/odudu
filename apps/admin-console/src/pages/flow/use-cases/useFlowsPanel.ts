import type { FlowWire, ListFlowsResponse } from '#/pages/flow/types/flows';
import { useRefusal } from '#/entities/session';
import { useDeleteFlow, useFlowsRecord } from '#/pages/flow/repository/useFlows';
import {
  deleteDialog,
  deleteOutcome,
  flowRows,
  newFlowHref,
  type FlowRow,
} from '#/pages/flow/services/flows';
import { FLOWS_WORDS, type FlowsWords } from '#/pages/flow/services/flowsWords';
import type { NamedDialog } from '#/shared/lib/services/dialog';
import type { RecordState } from '#/shared/lib/repository/useRecord';
import { useAnnouncedAction } from '#/shared/lib/use-cases/useAnnouncedAction';

export interface FlowsPanel {
  words: FlowsWords['list'];
  record: RecordState<ListFlowsResponse>;
  rows: FlowRow[];
  newHref: string;
  action: {
    dialog: NamedDialog | null;
    busy: boolean;
    problem: string | null;
    // What the last delete came to, for the line beside the list.
    notice: string | null;
    // How many deletes have ended where they were meant to, for the line's live region.
    count: number;
    ask: (flow: FlowWire) => void;
    cancel: () => void;
    confirm: () => Promise<boolean>;
  };
}

export function useFlowsPanel(tenant: string): FlowsPanel {
  const refusal = useRefusal(tenant);
  const record = useFlowsRecord(tenant);
  const remove = useDeleteFlow(tenant);
  const acting = useAnnouncedAction<FlowWire>({
    refusal,
    capability: 'manage-tenant',
    blocked: remove.busy,
    send: (flow) => remove.run(flow.id),
    outcomeOf: (flow, result) => deleteOutcome(flow.name, result),
  });
  return {
    words: FLOWS_WORDS.list,
    record,
    rows: flowRows(tenant, record.data?.items),
    newHref: newFlowHref(tenant),
    action: {
      dialog: deleteDialog(acting.asked),
      busy: remove.busy,
      problem: acting.problem,
      notice: acting.notice,
      count: acting.done,
      ask: acting.ask,
      cancel: acting.cancel,
      confirm: acting.confirm,
    },
  };
}
