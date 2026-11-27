import { json, type Answer } from '#/testing/fakeTransport';
import { GRACE, whoami } from '#/testing/renderConsole';
import { EVERY_TENANT_CAPABILITY } from '#/testing/roleAnswers';
import { ACME_ADMIN } from '#/testing/tenantPaths';

export const ACTIVITY = `${ACME_ADMIN}/assistant/activity`;
export const CONVERSATION_ID = '0b6f1c2e-5a7d-4e1a-9b3c-2d8f4a6e7c10';
export const PERSON_ID = '5c1d9a3e-2b4f-4c6a-8d7e-1f0a9b8c7d6e';
export const REPLAY = `${ACTIVITY}/conversations/${CONVERSATION_ID}`;
export const PROMPTFOO = `${REPLAY}/promptfoo`;
export const REPORT = `${ACME_ADMIN}/assistant/conversations/${CONVERSATION_ID}/report`;

export function conversation(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    person: PERSON_ID,
    person_username: 'ada',
    profile: 'free-chat',
    mode: 'ask',
    title: 'Which clients use refresh tokens?',
    started_at: '2026-11-25T08:00:00.000Z',
    last_active_at: '2026-11-25T08:05:00.000Z',
    turns: 2,
    steps: 5,
    tokens: { fast: 100, standard: 2400, deep: 0 },
    stop_reason: 'done',
    tools: ['list_clients', 'get_client'],
    report_old: false,
    approvals: 0,
    reported_at: null,
    ...extra,
  };
}

export const FIRST = conversation(CONVERSATION_ID);
export const SECOND = conversation('7e2d4f6a-8b1c-4d3e-9f5a-0c1b2d3e4f5a', {
  title: 'Delete the stale reports client',
  person_username: null,
  mode: 'act',
  stop_reason: 'awaiting_approval',
  approvals: 1,
  tools: [],
  reported_at: '2026-01-01T00:00:00.000Z',
  report_old: true,
});

const STEP_ONE = 'step-1';
const STEP_TWO = 'step-2';

export function replay(extra: Record<string, unknown> = {}) {
  return {
    conversation: {
      id: CONVERSATION_ID,
      person: PERSON_ID,
      person_username: 'ada',
      profile: 'free-chat',
      mode: 'act',
      started_at: '2026-11-25T08:00:00.000Z',
      last_active_at: '2026-11-25T08:05:00.000Z',
      reported_at: null,
    },
    asked: [{ at: '2026-11-25T08:00:00.000Z', text: 'Which clients use refresh tokens?' }],
    turns: [
      {
        id: 'turn-1',
        prompt_hash: 'abc',
        started_at: '2026-11-25T08:00:00.000Z',
        ended_at: '2026-11-25T08:00:09.000Z',
        stop_reason: 'done',
        why_model: [
          { slot: 'standard', reason: 'the profile asks for it', model: 'mock/standard-1' },
        ],
        why_stopped: 'The model finished its answer.',
        steps: [
          {
            id: STEP_ONE,
            parent_step_id: null,
            slot: 'standard',
            model: 'standard-1',
            provider_request_id: 'r1',
            input_tokens: 1200,
            output_tokens: 80,
            started_at: '2026-11-25T08:00:01.000Z',
            ended_at: '2026-11-25T08:00:03.500Z',
          },
          {
            id: STEP_TWO,
            parent_step_id: null,
            slot: 'standard',
            model: 'standard-1',
            provider_request_id: 'r2',
            input_tokens: 1500,
            output_tokens: 300,
            started_at: '2026-11-25T08:00:04.000Z',
            ended_at: '2026-11-25T08:00:09.000Z',
          },
        ],
        events: [
          {
            seq: 0,
            step_id: null,
            kind: 'slot_chosen',
            at: '2026-11-25T08:00:00.500Z',
            payload: { slot: 'standard', reason: 'the profile asks for it', provider: 'mock' },
          },
          {
            seq: 1,
            step_id: STEP_ONE,
            kind: 'tool_call',
            at: '2026-11-25T08:00:02.000Z',
            payload: { tool: 'list_clients', tool_call_id: 'c1', input: { limit: 10 } },
          },
          {
            seq: 2,
            step_id: STEP_ONE,
            kind: 'tool_result',
            at: '2026-11-25T08:00:03.000Z',
            payload: {
              tool: 'list_clients',
              tool_call_id: 'c1',
              ms: 41,
              output: { items: ['web'] },
            },
          },
          {
            seq: 3,
            step_id: STEP_TWO,
            kind: 'text',
            at: '2026-11-25T08:00:08.000Z',
            payload: { text: 'Only the web client does.' },
          },
        ],
      },
    ],
    turns_omitted: 0,
    text_visible: true,
    approvals: [
      {
        id: 'ap-1',
        tool_call_id: 'c9',
        tool: 'delete_client',
        title: 'Delete the client reports',
        target: 'client reports',
        state: 'denied',
        decided_at: '2026-11-25T08:04:00.000Z',
      },
    ],
    ...extra,
  };
}

export function activityRoutes(
  capabilities: readonly string[] = EVERY_TENANT_CAPABILITY,
  extra: Record<string, Answer> = {},
  assistantAvailable = true,
): Record<string, Answer> {
  return {
    'GET /console/api/session': json(GRACE),
    [`GET ${ACME_ADMIN}/whoami`]: whoami(capabilities, false, assistantAvailable),
    [`GET ${ACTIVITY}`]: json({ items: [FIRST, SECOND] }),
    [`GET ${REPLAY}`]: json(replay()),
    [`GET ${PROMPTFOO}`]: () =>
      new Response('{"description":"case"}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    [`POST ${REPORT}`]: json({
      reported_at: '2026-11-25T09:00:00.000Z',
      reported_count: 3,
      near_limit: false,
    }),
    ...extra,
  };
}
