import {
  assistantActivityReplaySchema,
  listAssistantActivityResponseSchema,
  reportConversationResponseSchema,
  type AssistantActivityConversation as WireConversation,
  type AssistantActivityReplay as WireReplay,
  type ListAssistantActivityResponse,
} from '@odudu/contracts/admin';
import { adminCall, mapResult, segment } from '#/shared/api/adapter/route';
import type { Gateway, GatewayResult } from '#/shared/api/transport/gateway';
import type { ListPage } from '#/shared/lib/services/resourceList';
import type {
  ActivityConversation,
  ExportedCase,
  Replay,
  Reported,
} from '#/pages/assistant-activity/types/activity';

function conversationOf(wire: WireConversation): ActivityConversation {
  return {
    id: wire.id,
    person: wire.person,
    personName: wire.person_username,
    profile: wire.profile,
    mode: wire.mode,
    title: wire.title,
    startedAt: wire.started_at,
    lastActiveAt: wire.last_active_at,
    turns: wire.turns,
    steps: wire.steps,
    tokens: wire.tokens,
    stopReason: wire.stop_reason,
    tools: wire.tools,
    approvals: wire.approvals,
    reportedAt: wire.reported_at,
    reportOld: wire.report_old,
  };
}

function pageOf(wire: ListAssistantActivityResponse): ListPage<ActivityConversation> {
  return { items: wire.items.map(conversationOf), next: wire.next };
}

export async function readActivityPage(
  gateway: Gateway,
  tenant: string,
  query: URLSearchParams,
): Promise<GatewayResult<ListPage<ActivityConversation>>> {
  const result = await adminCall(gateway, 'GET', tenant, ['assistant', 'activity'], {
    query,
    schema: listAssistantActivityResponseSchema,
  });
  return mapResult(result, pageOf);
}

function replayOf(wire: WireReplay): Replay {
  const { conversation } = wire;
  return {
    id: conversation.id,
    person: conversation.person,
    personName: conversation.person_username,
    profile: conversation.profile,
    mode: conversation.mode,
    startedAt: conversation.started_at,
    lastActiveAt: conversation.last_active_at,
    reportedAt: conversation.reported_at,
    asked: wire.asked,
    turns: wire.turns.map((turn) => ({
      id: turn.id,
      startedAt: turn.started_at,
      endedAt: turn.ended_at,
      stopReason: turn.stop_reason,
      whyModel: turn.why_model,
      whyStopped: turn.why_stopped,
      steps: turn.steps.map((step) => ({
        id: step.id,
        slot: step.slot,
        model: step.model,
        inputTokens: step.input_tokens,
        outputTokens: step.output_tokens,
        startedAt: step.started_at,
        endedAt: step.ended_at,
      })),
      events: turn.events.map((event) => ({
        seq: event.seq,
        stepId: event.step_id,
        kind: event.kind,
        at: event.at,
        payload: event.payload,
      })),
    })),
    turnsOmitted: wire.turns_omitted,
    textVisible: wire.text_visible,
    approvals: wire.approvals.map((approval) => ({
      id: approval.id,
      tool: approval.tool,
      title: approval.title,
      target: approval.target,
      state: approval.state,
      decidedAt: approval.decided_at,
    })),
  };
}

export async function readReplay(
  gateway: Gateway,
  tenant: string,
  id: string,
): Promise<GatewayResult<Replay>> {
  const result = await adminCall(
    gateway,
    'GET',
    tenant,
    ['assistant', 'activity', 'conversations', id],
    { schema: assistantActivityReplaySchema },
  );
  return mapResult(result, replayOf);
}

// The promptfoo test case as the text the server sent, saved as it is.
export async function exportCase(
  gateway: Gateway,
  tenant: string,
  id: string,
): Promise<GatewayResult<ExportedCase>> {
  const t = segment(tenant);
  const c = segment(id);
  const result = await gateway.download(
    'GET',
    `admin/tenants/${t}/assistant/activity/conversations/${c}/promptfoo`,
  );
  return mapResult(result, ({ text, contentType }) => ({ text, contentType }));
}

// Keeps the conversation past retention; asking again changes nothing.
export async function reportConversation(
  gateway: Gateway,
  tenant: string,
  id: string,
): Promise<GatewayResult<Reported>> {
  const result = await adminCall(
    gateway,
    'POST',
    tenant,
    ['assistant', 'conversations', id, 'report'],
    { schema: reportConversationResponseSchema },
  );
  return mapResult(result, (wire) => ({
    reportedAt: wire.reported_at,
    reportedCount: wire.reported_count,
    nearLimit: wire.near_limit,
  }));
}
