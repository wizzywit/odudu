import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface Recorded {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export interface Reply {
  status: number;
  headers?: Record<string, string>;
  body?: string;
  // Never answers: the request stays open until the server is closed.
  hang?: boolean;
}

export interface FakeApi {
  origin: string;
  requests: Recorded[];
  close: () => Promise<void>;
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks).toString('utf8');
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Reply {
  return {
    status,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  };
}

// The handler sees every request in arrival order and its zero-based index, so a
// test can answer the first attempt differently from the retry.
export async function startFakeApi(
  handler: (request: Recorded, index: number) => Reply,
): Promise<FakeApi> {
  const requests: Recorded[] = [];
  const server = createServer((request, response) => {
    readBody(request).then(
      (body) => {
        const recorded: Recorded = {
          method: request.method ?? '',
          url: request.url ?? '',
          headers: request.headers,
          body,
        };
        requests.push(recorded);
        const reply = handler(recorded, requests.length - 1);
        if (reply.hang === true) return;
        response.writeHead(reply.status, reply.headers);
        response.end(reply.body);
      },
      () => response.destroy(),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${String(port)}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}
