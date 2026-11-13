import type { ListFlowsResponse } from '#/pages/flow/types/flows';
import { useRefusal } from '#/entities/session';
import {
  useDeleteFlow,
  useFlowsRecord,
  useMakeFlowDefault,
} from '#/pages/flow/repository/useFlows';
import {
  askedDialog,
  askedOutcome,
  flowRows,
  newFlowHref,
  type AskedAction,
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
    ask: (asked: AskedAction) => void;
    cancel: () => void;
    confirm: () => Promise<boolean>;
  };
}

export function useFlowsPanel(tenant: string): FlowsPanel {
  const refusal = useRefusal(tenant);
  const record = useFlowsRecord(tenant);
  const remove = useDeleteFlow(tenant);
  const promote = useMakeFlowDefault(tenant);
  const writes = { delete: remove.run, default: promote.run };
  const acting = useAnnouncedAction<AskedAction>({
    refusal,
    capability: 'manage-tenant',
    blocked: remove.busy || promote.busy,
    send: (asked) => writes[asked.action](asked.flow.id),
    outcomeOf: askedOutcome,
  });
  return {
    words: FLOWS_WORDS.list,
    record,
    rows: flowRows(tenant, record.data?.items),
    newHref: newFlowHref(tenant),
    action: {
      dialog: askedDialog(acting.asked),
      busy: remove.busy || promote.busy,
      problem: acting.problem,
      notice: acting.notice,
      count: acting.done,
      ask: acting.ask,
      cancel: acting.cancel,
      confirm: acting.confirm,
    },
  };
}
