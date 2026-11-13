import type { ListFlowsResponse } from '#/pages/flow/types/flows';
import { useRefusal } from '#/entities/session';
import {
  useDeleteFlow,
  useFlowById,
  useFlowsRecord,
  useMakeFlowDefault,
} from '#/pages/flow/repository/useFlows';
import {
  askedOutcome,
  confirmation,
  confirmedWrite,
  readTarget,
  flowRows,
  newFlowHref,
  type AskedAction,
  type FlowRow,
} from '#/pages/flow/services/flows';
import { FLOWS_WORDS, type FlowsWords } from '#/pages/flow/services/flowsWords';
import type { NamedDialog } from '#/shared/lib/services/dialog';
import type { RecordState } from '#/shared/lib/repository/useRecord';
import {
  useAnnouncedAction,
  type AnnouncedAction,
} from '#/shared/lib/use-cases/useAnnouncedAction';

export interface FlowsPanel {
  words: FlowsWords['list'];
  record: RecordState<ListFlowsResponse>;
  rows: FlowRow[];
  newHref: string;
  action: {
    dialog: NamedDialog | null;
    busy: boolean;
    // Held until the flow the confirmation binds to is read.
    held: boolean;
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
  const acting: AnnouncedAction<AskedAction> = useAnnouncedAction<AskedAction>({
    refusal,
    capability: 'manage-tenant',
    blocked: remove.busy || promote.busy,
    send: (asked) => writes[asked.action](confirmedWrite(asked, target.etag)),
    outcomeOf: askedOutcome,
  });
  // The version the administrator confirms is the one read when the dialog opens.
  const read = readTarget(acting.asked);
  const target = useFlowById(tenant, read.id, read.enabled);
  const confirming = confirmation(
    acting.asked,
    target.data,
    target.etag,
    target.status,
    acting.problem,
  );
  return {
    words: FLOWS_WORDS.list,
    record,
    rows: flowRows(tenant, record.data?.items),
    newHref: newFlowHref(tenant),
    action: {
      dialog: confirming.dialog,
      held: confirming.held,
      busy: remove.busy || promote.busy,
      problem: confirming.problem,
      notice: acting.notice,
      count: acting.done,
      ask: acting.ask,
      cancel: acting.cancel,
      confirm: acting.confirm,
    },
  };
}
