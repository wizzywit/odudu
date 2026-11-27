import { DefaultChatTransport, type UIMessage } from 'ai';
import { segment } from '#/shared/api/adapter/route';
import type { Gateway, StreamResult } from '#/shared/api/transport/gateway';
import { deferStreamError } from '#/widgets/assistant-panel/adapter/deferError';
import { watchSteps } from '#/widgets/assistant-panel/adapter/watchSteps';
import { ChatCallError } from '#/widgets/assistant-panel/services/chatCallError';
import type { StepEvent } from '#/widgets/assistant-panel/services/stepTimes';

// A message, answered as a stream of the assistant's reply.
export function sendMessageStream(
  gateway: Gateway,
  tenant: string,
  id: string,
  body: string,
  signal: AbortSignal | null | undefined,
): Promise<StreamResult> {
  return gateway.stream(
    'POST',
    `admin/tenants/${segment(tenant)}/assistant/conversations/${segment(id)}/messages`,
    { body, signal: signal ?? undefined },
  );
}

// Carries a turn on after the person has decided a change it waited on.
export function resumeStream(
  gateway: Gateway,
  tenant: string,
  id: string,
  signal: AbortSignal | null | undefined,
): Promise<StreamResult> {
  return gateway.stream(
    'POST',
    `admin/tenants/${segment(tenant)}/assistant/conversations/${segment(id)}/resume`,
    { signal: signal ?? undefined },
  );
}

function textOf(message: UIMessage | undefined): string {
  if (message === undefined) return '';
  return message.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n');
}

// The chat client's transport over the console's gateway: the same headers,
// session and refusals as every other call, and no address of its own. A
// message is the last thing the person typed, since the server keeps the rest;
// a turn that ends on an assistant message is carried on rather than sent.
export function chatTransport(options: {
  gateway: Gateway;
  tenant: string;
  // The conversation's id, starting the conversation when it has none yet.
  conversation: () => Promise<string>;
  // Called once the server has accepted a turn, before any of its answer.
  onConnected?: () => void;
  // Called as each tool call of the answer begins, ends or stops for a decision.
  onStep?: (step: StepEvent) => void;
}): DefaultChatTransport<UIMessage> {
  const { gateway, tenant, conversation, onConnected, onStep } = options;
  return new DefaultChatTransport<UIMessage>({
    api: 'assistant',
    prepareSendMessagesRequest: async ({ messages }) => {
      const id = await conversation();
      const last = messages[messages.length - 1];
      if (last?.role === 'assistant') return { api: `resume:${id}`, body: {} };
      const message = {
        id: last?.id ?? '',
        role: 'user',
        parts: [{ type: 'text', text: textOf(last) }],
      };
      return { api: `messages:${id}`, body: { message } };
    },
    fetch: async (api, init) => {
      const [route = '', id = ''] = (typeof api === 'string' ? api : '').split(':');
      const signal = init?.signal;
      const result =
        route === 'resume'
          ? await resumeStream(gateway, tenant, id, signal)
          : await sendMessageStream(
              gateway,
              tenant,
              id,
              typeof init?.body === 'string' ? init.body : '',
              signal,
            );
      if (!result.ok) throw new ChatCallError(result, route === 'resume' ? 'resume' : 'messages');
      onConnected?.();
      const { response } = result;
      if (response.body === null) return response;
      const held = deferStreamError(response.body);
      return new Response(onStep === undefined ? held : watchSteps(held, onStep), {
        status: response.status,
        headers: response.headers,
      });
    },
  });
}
