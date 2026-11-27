// A stand-in for an OpenAI-compatible model server, for the browser tests of the
// console assistant: it answers `/v1/chat/completions` with a streamed reply
// replayed from a fixture, chosen by what the person last wrote and how many tool
// results have come back since. It calls no model and keeps no state, and it has
// no imports of this repository's, so node runs it as it is (e2e/run.sh imports it).
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

interface Reply {
  tool?: { name: string; arguments: Record<string, unknown> };
  text?: string;
}

interface Fixture {
  match: RegExp;
  // The reply for each round of one turn: the first asks for a tool, the next
  // ones answer once its result is back.
  rounds: readonly Reply[];
}

export const FIXTURES: readonly Fixture[] = [
  {
    match: /approve me elsewhere/iu,
    rounds: [
      {
        tool: {
          name: 'create_group',
          arguments: { name: 'e2e-approved-elsewhere', idempotency_key: 'e2e-approve-elsewhere-1' },
        },
      },
      { text: 'The group e2e-approved-elsewhere was created.' },
    ],
  },
  {
    match: /how many clients/iu,
    rounds: [
      { tool: { name: 'count_clients', arguments: {} } },
      { text: 'I counted the clients with count_clients. The number is in the step above.' },
    ],
  },
  {
    match: /approve me/iu,
    rounds: [
      {
        tool: {
          name: 'create_group',
          arguments: { name: 'e2e-approved', idempotency_key: 'e2e-approve-1' },
        },
      },
      { text: 'The group e2e-approved was created.' },
    ],
  },
  {
    match: /refuse me/iu,
    rounds: [
      {
        tool: {
          name: 'create_group',
          arguments: { name: 'e2e-refused', idempotency_key: 'e2e-refuse-1' },
        },
      },
      { text: 'Understood. I did not create the group e2e-refused.' },
    ],
  },
];

const FALLBACK: Fixture = {
  match: /./u,
  rounds: [{ text: 'This stub answers only the fixtures it was given.' }],
};

interface Message {
  role?: unknown;
  content?: unknown;
  tool_calls?: unknown;
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part: unknown) => {
      if (typeof part !== 'object' || part === null) return '';
      const { text } = part as { text?: unknown };
      return typeof text === 'string' ? text : '';
    })
    .join('');
}

// How many rounds of this turn have gone by: each one leaves an assistant
// message that called a tool, and, when the tool ran or was refused, a tool
// message. Counting both keeps a refused call from being asked for again.
function roundOf(messages: readonly Message[], last: number): number {
  const since = messages.slice(last + 1);
  const called = since.filter(
    (message) =>
      message.role === 'assistant' &&
      Array.isArray(message.tool_calls) &&
      message.tool_calls.length > 0,
  ).length;
  const answered = since.filter((message) => message.role === 'tool').length;
  return Math.max(called, answered);
}

// The fixture the last thing a person said picks, and how many tool results
// followed it, which is the round the turn is in.
export function replyFor(messages: readonly Message[]): Reply {
  const last = messages.map((message) => message.role).lastIndexOf('user');
  const said = last < 0 ? '' : textOf(messages[last]?.content);
  const fixture = FIXTURES.find((entry) => entry.match.test(said)) ?? FALLBACK;
  const round = roundOf(messages, last);
  return fixture.rounds[Math.min(round, fixture.rounds.length - 1)] ?? {};
}

function chunk(delta: Record<string, unknown>, finish: string | null): string {
  return `data: ${JSON.stringify({
    id: 'chatcmpl-stub',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'stub-model',
    choices: [{ index: 0, delta, finish_reason: finish }],
  })}\n\n`;
}

// The reply as the chunks of a streamed chat completion, ending with the usage
// a token budget counts.
export function streamOf(reply: Reply, round: number): string {
  const parts = [chunk({ role: 'assistant', content: '' }, null)];
  if (reply.tool !== undefined) {
    parts.push(
      chunk(
        {
          tool_calls: [
            {
              index: 0,
              id: `call_stub_${String(round)}`,
              type: 'function',
              function: { name: reply.tool.name, arguments: JSON.stringify(reply.tool.arguments) },
            },
          ],
        },
        null,
      ),
      chunk({}, 'tool_calls'),
    );
  } else {
    parts.push(chunk({ content: reply.text ?? '' }, null), chunk({}, 'stop'));
  }
  parts.push(
    `data: ${JSON.stringify({
      id: 'chatcmpl-stub',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'stub-model',
      choices: [],
      usage: { prompt_tokens: 40, completion_tokens: 10, total_tokens: 50 },
    })}\n\n`,
    'data: [DONE]\n\n',
  );
  return parts.join('');
}

function read(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (piece: Buffer) => chunks.push(piece));
    request.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    request.on('error', reject);
  });
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200).end('ok');
    return;
  }
  if (request.method !== 'POST' || !(request.url ?? '').endsWith('/chat/completions')) {
    response.writeHead(404).end();
    return;
  }
  const body = JSON.parse(await read(request)) as { messages?: Message[] };
  const messages = body.messages ?? [];
  const last = messages.map((message) => message.role).lastIndexOf('user');
  const round = roundOf(messages, last);
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
  response.end(streamOf(replyFor(messages), round));
}

export function startProviderStub(port: number): Promise<Server> {
  const server = createServer((request, response) => {
    handle(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  return new Promise((resolve) => {
    server.listen(port, '0.0.0.0', () => {
      resolve(server);
    });
  });
}
