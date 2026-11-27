import {
  assistantApprovalListSchema,
  decideApprovalResponseSchema,
  type DecideApprovalResponse,
} from '@odudu/contracts/admin';
import { adminCall, segment } from '#/shared/api/adapter/route';
import type { Gateway, GatewayResult } from '#/shared/api/transport/gateway';
import { clockOffset } from '#/widgets/assistant-panel/services/approval';
import type { ApprovalList } from '#/widgets/assistant-panel/types/approvals';

// The changes of the conversation that still wait for the person, with how far
// the server's clock is from this browser's. The clock comes from the answer's
// `Date` header, which the reading helpers do not pass on, so the answer is
// read as the text it is and parsed here.
export async function listApprovals(
  gateway: Gateway,
  tenant: string,
  id: string,
  now: () => number = Date.now,
): Promise<GatewayResult<ApprovalList>> {
  const result = await gateway.download(
    'GET',
    `admin/tenants/${segment(tenant)}/assistant/conversations/${segment(id)}/approvals`,
  );
  if (!result.ok) return result;
  let body: unknown;
  try {
    body = JSON.parse(result.data.text);
  } catch {
    return { ok: false, kind: 'schema' };
  }
  const parsed = assistantApprovalListSchema.safeParse(body);
  if (!parsed.success) return { ok: false, kind: 'schema' };
  return {
    ...result,
    data: { items: parsed.data.items, offsetMs: clockOffset(result.data.date, now()) },
  };
}

// The person's decision on one change. Only a console sign-in may make it; the
// server answers 409 for one already decided or expired.
export function decideApproval(
  gateway: Gateway,
  tenant: string,
  id: string,
  approvalId: string,
  approve: boolean,
): Promise<GatewayResult<DecideApprovalResponse>> {
  return adminCall(
    gateway,
    'POST',
    tenant,
    ['assistant', 'conversations', id, 'approvals', approvalId],
    { body: { approve }, schema: decideApprovalResponseSchema },
  );
}
