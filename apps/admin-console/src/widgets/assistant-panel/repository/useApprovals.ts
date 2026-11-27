import type { GatewayResult } from '#/shared/api/transport/gateway';
import { useTransport } from '#/shared/api/transport/useTransport';
import { assistantApprovalsKey } from '#/shared/lib/repository/queryKeys';
import { useInvalidate } from '#/shared/lib/repository/useInvalidate';
import { useRead } from '#/shared/lib/repository/useRead';
import { useGatewayWrite, type Write } from '#/shared/lib/repository/useWrite';
import type { Read } from '#/shared/lib/services/read';
import { decideApproval, listApprovals } from '#/widgets/assistant-panel/adapter/approvals';
import type { ApprovalList } from '#/widgets/assistant-panel/types/approvals';
import type { DecideApprovalResponse } from '#/widgets/assistant-panel/types/contracts';

// The changes the conversation waits on, read while one is waiting and read
// again after each decision.
export function useApprovalList(
  tenant: string,
  conversationId: string | null,
  asked: boolean,
): Read<ApprovalList> {
  const { gateway } = useTransport();
  const id = conversationId ?? '';
  return useRead(
    assistantApprovalsKey(tenant, id),
    asked && conversationId !== null,
    () => listApprovals(gateway, tenant, id),
    { fresh: true },
  );
}

export type DecideWrite = Write<
  { approvalId: string; approve: boolean; confirm?: string },
  GatewayResult<DecideApprovalResponse>
>;

export function useDecideApproval(tenant: string, conversationId: string | null): DecideWrite {
  const { invalidate } = useInvalidate();
  const id = conversationId ?? '';
  return useGatewayWrite({
    send: (gateway, arg: { approvalId: string; approve: boolean; confirm?: string }) =>
      decideApproval(gateway, tenant, id, arg.approvalId, arg.approve, arg.confirm),
    onSettled: () => {
      invalidate(assistantApprovalsKey(tenant, id));
    },
  });
}
