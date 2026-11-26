import { TOOLS, type ToolResult } from '@odudu/mcp';
import { toUIMessageStream, type UIMessage, type UIMessageChunk } from 'ai';
import { convertArrayToReadableStream, MockLanguageModelV3 } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';
import { ASK_MODE_DENIAL } from '#/service/approval-policy';
import type { TaskProfile } from '#/service/profile';
import { startTurn, type RunTurnDeps } from '#/usecase/run-turn';
import type { TurnApprovals } from '#/usecase/tool-approval';

const PROFILE: TaskProfile = { id: 'free-chat', slot: 'standard', maxSteps: 5 };
const CONVERSATION = '0192a0a0-0000-7000-8000-0000000000c1';
const CLIENT = '0192a0a0-0000-7000-8000-0000000000a1';

const USAGE = {
  inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 2, text: 2, reasoning: 0 },
};

type Part = Record<string, unknown>;

function toolCall(id: string, name: string, input: unknown): Part[] {
  return [
    { type: 'tool-call', toolCallId: id, toolName: name, input: JSON.stringify(input) },
    { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage: USAGE },
  ];
}

function answer(text: string): Part[] {
  return [
    { type: 'text-start', id: 'a' },
    { type: 'text-delta', id: 'a', delta: text },
    { type: 'text-end', id: 'a' },
    { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage: USAGE },
  ];
}

function scripted(replies: Part[][]): MockLanguageModelV3 {
  let call = 0;
  return new MockLanguageModelV3({
    doStream: () => {
      const reply = replies[Math.min(call, replies.length - 1)] ?? [];
      call += 1;
      return Promise.resolve({
        stream: convertArrayToReadableStream([
          { type: 'stream-start', warnings: [] },
          ...reply,
        ] as never),
      });
    },
  });
}

const CLIENT_READ: ToolResult = {
  isError: false,
  content: [{ type: 'text', text: '{}' }],
  structuredContent: { data: { name: 'Acme app', description: 'Old text' } },
};

const NOT_FOUND: ToolResult = {
  isError: true,
  content: [{ type: 'text', text: '{}' }],
  structuredContent: { error: { type: 'about:blank', title: 'Not Found', status: 404 } },
};

const WRITE_INPUT = { id: CLIENT, if_match: '"v1"', description: 'New text' };

function setup(
  model: MockLanguageModelV3,
  mode: 'ask' | 'act',
  read: ToolResult = CLIENT_READ,
  approvalSecret?: Uint8Array,
) {
  const callTool = vi.fn<RunTurnDeps['callTool']>(() => Promise.resolve(read));
  const proposed = vi.fn<TurnApprovals['proposed']>();
  const open = vi.fn<TurnApprovals['open']>((call) =>
    Promise.resolve({
      kind: 'opened',
      card: {
        approval_id: 'ap-1',
        tool_call_id: call.toolCallId,
        tool: call.tool,
        ...call.body,
        expires_at: '2026-11-26T10:00:00.000Z',
      },
    }),
  );
  const write = vi.fn<TurnApprovals['write']>(() =>
    Promise.resolve({
      kind: 'done',
      result: { isError: false, content: [], structuredContent: { data: { id: CLIENT } } },
    }),
  );
  const deps = (history: UIMessage[] = []): RunTurnDeps => ({
    model,
    profile: PROFILE,
    tenantText: 'Acme',
    tools: TOOLS,
    mode,
    history: () => Promise.resolve(history),
    mintToken: () => Promise.resolve({ accessToken: 'token' }),
    callTool,
    approvals: { open, write, proposed },
    ...(approvalSecret === undefined ? {} : { approvalSecret }),
  });
  return { deps, callTool, open, write, proposed };
}

async function drain(deps: RunTurnDeps, message?: UIMessage) {
  const started = await startTurn(deps, {
    conversationId: CONVERSATION,
    ...(message === undefined ? {} : { message }),
    signal: new AbortController().signal,
  });
  const chunks: UIMessageChunk[] = [];
  const errors: unknown[] = [];
  let response: UIMessage | undefined;
  const history = [...(await deps.history(CONVERSATION))];
  const ui = toUIMessageStream({
    stream: started.result.stream,
    tools: started.tools,
    originalMessages: message === undefined ? history : [...history, message],
    generateMessageId: () => 'm-new',
    onError: (error) => {
      errors.push(error);
      return 'failed';
    },
    onEnd: ({ responseMessage }) => {
      response = responseMessage;
    },
  });
  const reader = ui.getReader();
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    chunks.push(next.value);
  }
  return { chunks, response, errors };
}

const ask = (text: string): UIMessage => ({
  id: 'u1',
  role: 'user',
  parts: [{ type: 'text', text }],
});

describe('Ask mode', () => {
  it('refuses a change with a reason the model reads, and proposes nothing', async () => {
    const model = scripted([
      toolCall('call-1', 'update_client_metadata', WRITE_INPUT),
      answer('I cannot change it in Ask mode.'),
    ]);
    const { deps, open, write, callTool } = setup(model, 'ask');
    const out = await drain(deps(), ask('change the description'));
    expect(open).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(callTool).not.toHaveBeenCalled();
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain(ASK_MODE_DENIAL);
    // The SDK reports its own automatic refusal as a request that is already answered.
    const requests = out.chunks.filter((chunk) => chunk.type === 'tool-approval-request');
    expect(requests.every((chunk) => 'isAutomatic' in chunk && chunk.isAutomatic)).toBe(true);
  });
});

describe('Act mode', () => {
  it('stores the proposal from a read the server made and ends on the approval request', async () => {
    const model = scripted([
      toolCall('call-1', 'update_client_metadata', WRITE_INPUT),
      answer('should not be reached'),
    ]);
    const { deps, open, write, proposed, callTool } = setup(model, 'act');
    const out = await drain(deps(), ask('change the description'));

    expect(callTool).toHaveBeenCalledTimes(1);
    expect(callTool.mock.calls[0]?.[1]).toBe('get_client');
    expect(callTool.mock.calls[0]?.[2]).toEqual({ id: CLIENT });
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]?.[0].body).toMatchObject({
      before: { description: 'Old text' },
      after: { description: 'New text' },
      target: { type: 'client', id: CLIENT, name: 'Acme app' },
    });
    expect(proposed).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled();
    expect(out.chunks.some((chunk) => chunk.type === 'tool-approval-request')).toBe(true);
    expect(model.doStreamCalls).toHaveLength(1);
    const part = out.response?.parts.find((entry) => entry.type === 'tool-update_client_metadata');
    expect(part).toMatchObject({ state: 'approval-requested', toolCallId: 'call-1' });
  });

  it('does not propose a change to something that is not there', async () => {
    const model = scripted([
      toolCall('call-1', 'update_client_metadata', WRITE_INPUT),
      answer('It does not exist.'),
    ]);
    const { deps, open } = setup(model, 'act', NOT_FOUND);
    await drain(deps(), ask('change it'));
    expect(open).not.toHaveBeenCalled();
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain('does not exist');
  });

  it('refuses a proposal when the person already holds the most pending changes', async () => {
    const model = scripted([
      toolCall('call-1', 'update_client_metadata', WRITE_INPUT),
      answer('Too many are waiting.'),
    ]);
    const { deps, open, proposed } = setup(model, 'act');
    open.mockResolvedValueOnce({ kind: 'refused', reason: 'limit' });
    await drain(deps(), ask('change it'));
    expect(proposed).not.toHaveBeenCalled();
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain('as many changes waiting');
  });

  it('refuses a change too large for the card to show whole, and says which field', async () => {
    const huge = { if_match: '"v1"', stylesheet: 'a{}'.repeat(43_000) };
    const model = scripted([
      toolCall('call-1', 'update_theme_draft', huge),
      answer('That is too large for me to propose.'),
    ]);
    const { deps, open, proposed } = setup(model, 'act');
    await drain(deps(), ask('replace the stylesheet'));
    expect(open).not.toHaveBeenCalled();
    expect(proposed).not.toHaveBeenCalled();
    expect(model.doStreamCalls[1] && JSON.stringify(model.doStreamCalls[1].prompt)).toMatch(
      /stylesheet.*console/u,
    );
  });

  it('tells the model when the conversation or the person already has the most waiting', async () => {
    for (const [reason, words] of [
      ['conversation_cap', 'in this conversation'],
      ['owner_cap', 'for this person'],
    ] as const) {
      const model = scripted([
        toolCall('call-1', 'update_client_metadata', WRITE_INPUT),
        answer('Too many are waiting.'),
      ]);
      const { deps, open, proposed } = setup(model, 'act');
      open.mockResolvedValueOnce({ kind: 'refused', reason });
      await drain(deps(), ask('change it'));
      expect(proposed).not.toHaveBeenCalled();
      expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain(words);
    }
  });

  it('does not run a write the SDK reaches without an approval for it', async () => {
    const model = scripted([
      toolCall('call-1', 'update_client_metadata', WRITE_INPUT),
      answer('done'),
    ]);
    const { deps, write } = setup(model, 'act');
    write.mockResolvedValue({ kind: 'not_approved' });
    const history = [
      ask('change it'),
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-update_client_metadata',
            toolCallId: 'call-1',
            state: 'approval-responded',
            input: WRITE_INPUT,
            approval: { id: 'sdk-approval-1', approved: true },
          },
        ],
      } as UIMessage,
    ];
    await drain(deps(history));
    expect(write).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).toContain('The change was not made');
  });
});

function storedRequest(state: string, extra: Record<string, unknown> = {}): UIMessage[] {
  return [
    ask('change the description'),
    {
      id: 'a1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-update_client_metadata',
          toolCallId: 'call-1',
          state,
          input: WRITE_INPUT,
          approval: { id: 'sdk-approval-1', ...extra },
        },
      ],
    } as UIMessage,
  ];
}

describe('resuming after a decision', () => {
  it('runs the approved change once and lets the model answer from its result', async () => {
    const model = scripted([answer('The description is changed.')]);
    const { deps, write, open } = setup(model, 'act');
    const out = await drain(deps(storedRequest('approval-responded', { approved: true })));
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0]).toBe('update_client_metadata');
    expect(write.mock.calls[0]?.[1]).toEqual(WRITE_INPUT);
    expect(write.mock.calls[0]?.[2].toolCallId).toBe('call-1');
    expect(open).not.toHaveBeenCalled();
    expect(JSON.stringify(out.response?.parts)).toContain('The description is changed.');
    const part = out.response?.parts.find((entry) => entry.type === 'tool-update_client_metadata');
    expect(part).toMatchObject({ state: 'output-available' });
  });

  it('lets the model see a refusal and runs nothing', async () => {
    const model = scripted([answer('Understood, I left it.')]);
    const { deps, write } = setup(model, 'act');
    await drain(
      deps(storedRequest('output-denied', { approved: false, reason: 'The person declined.' })),
    );
    expect(write).not.toHaveBeenCalled();
    expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).toContain('declined');
  });
});

describe('the signature on a pending request', () => {
  const secret = new Uint8Array(32).fill(9);

  async function requested() {
    const first = setup(
      scripted([toolCall('call-1', 'update_client_metadata', WRITE_INPUT)]),
      'act',
      CLIENT_READ,
      secret,
    );
    const out = await drain(first.deps(), ask('change the description'));
    const part = out.response?.parts.find(
      (entry) => entry.type === 'tool-update_client_metadata',
    ) as { approval?: { id: string; signature?: string } } | undefined;
    return part;
  }

  function stored(part: unknown, change: (copy: Record<string, unknown>) => void): UIMessage[] {
    const copy = JSON.parse(JSON.stringify(part)) as Record<string, unknown>;
    copy.state = 'approval-responded';
    copy.approval = { ...(copy.approval as object), approved: true };
    change(copy);
    return [
      ask('change the description'),
      { id: 'a1', role: 'assistant', parts: [copy] } as unknown as UIMessage,
    ];
  }

  it('is put on the request, and an approved request that carries it runs', async () => {
    const part = await requested();
    expect(part?.approval?.signature).toEqual(expect.any(String));
    const next = setup(scripted([answer('Done.')]), 'act', CLIENT_READ, secret);
    await drain(next.deps(stored(part, () => undefined)));
    expect(next.write).toHaveBeenCalledTimes(1);
  });

  it('never runs a request whose call was edited, whose signature was removed or that another secret signed', async () => {
    const part = await requested();
    const edits: ((copy: Record<string, unknown>) => void)[] = [
      (copy) => {
        copy.input = { ...(copy.input as object), description: 'Something else' };
      },
      (copy) => {
        copy.approval = { id: (copy.approval as { id: string }).id, approved: true };
      },
    ];
    for (const change of edits) {
      const next = setup(scripted([answer('Done.')]), 'act', CLIENT_READ, secret);
      const refused = await drain(next.deps(stored(part, change)));
      expect((refused.errors[0] as Error | undefined)?.name).toBe(
        'AI_InvalidToolApprovalSignatureError',
      );
      expect(next.write).not.toHaveBeenCalled();
    }
    const other = setup(
      scripted([answer('Done.')]),
      'act',
      CLIENT_READ,
      new Uint8Array(32).fill(1),
    );
    const refusedOther = await drain(other.deps(stored(part, () => undefined)));
    expect((refusedOther.errors[0] as Error | undefined)?.name).toBe(
      'AI_InvalidToolApprovalSignatureError',
    );
    expect(other.write).not.toHaveBeenCalled();
  });
});
