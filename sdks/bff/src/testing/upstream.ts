import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { IncomingHttpHeaders } from 'node:http';

export interface Seen {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

export type Responder = (request: IncomingMessage, response: ServerResponse, seen: Seen) => void;

export interface FakeUpstream {
  origin: string;
  // Requests that arrived whole.
  seen: Seen[];
  // Requests that began, whether or not they finished.
  started: number;
  // Request body bytes received, finished or not.
  bytesReceived: number;
  // Responses cut off before they ended: the caller hung up or aborted.
  hungUp: number;
  close: () => Promise<void>;
}

const ok: Responder = (_request, response) => {
  response.writeHead(200, { 'content-type': 'application/json', 'x-upstream': 'yes' });
  response.end('{"ok":true}');
};

export async function startUpstream(respond: Responder = ok): Promise<FakeUpstream> {
  const upstream: FakeUpstream = {
    origin: '',
    seen: [],
    started: 0,
    bytesReceived: 0,
    hungUp: 0,
    close: () => Promise.resolve(),
  };
  const server = createServer((request, response) => {
    upstream.started += 1;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      upstream.bytesReceived += chunk.length;
      chunks.push(chunk);
    });
    request.on('end', () => {
      const seen: Seen = {
        method: request.method ?? '',
        url: request.url ?? '',
        headers: request.headers,
        body: Buffer.concat(chunks),
      };
      upstream.seen.push(seen);
      respond(request, response, seen);
    });
    response.on('close', () => {
      if (!response.writableEnded) upstream.hungUp += 1;
    });
    request.on('error', () => undefined);
    response.on('error', () => undefined);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  upstream.origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  upstream.close = () =>
    new Promise<void>((resolve, reject) => {
      server.closeAllConnections();
      server.close((error) => {
        if (error === undefined) resolve();
        else reject(error);
      });
    });
  return upstream;
}
