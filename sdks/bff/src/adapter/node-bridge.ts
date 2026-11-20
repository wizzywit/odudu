import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Handler } from '#/types';

// The handlers read the path, the query and the headers of a request and
// nothing of its host, so a fixed base stands in for an address a proxy in
// front may have changed.
const BASE = 'http://localhost';
const NO_BODY = new Set(['GET', 'HEAD']);

function webHeaders(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    for (const part of Array.isArray(value) ? value : [value]) headers.append(name, part);
  }
  return headers;
}

// A body is present when the request says so; an empty POST is not given an
// empty stream, which would make the upstream call chunked.
function hasBody(req: IncomingMessage): boolean {
  const { headers, method = 'GET' } = req;
  if (NO_BODY.has(method)) return false;
  return headers['transfer-encoding'] !== undefined || (headers['content-length'] ?? '0') !== '0';
}

// The request as a Web `Request`. Its body is the socket's stream, read only
// when something reads it, so no framework or handler buffers it first.
export function toWebRequest(req: IncomingMessage, url: string): Request {
  const method = req.method ?? 'GET';
  const headers = webHeaders(req);
  if (!hasBody(req)) return new Request(new URL(url, BASE), { method, headers });
  return new Request(new URL(url, BASE), {
    method,
    headers,
    body: Readable.toWeb(req),
    duplex: 'half',
  });
}

// Writes the response, every Set-Cookie line of it and then its body as it
// arrives. A body that fails part way destroys the connection, which is how
// the browser learns it was cut short.
export async function writeWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  if (response.statusText !== '') res.statusMessage = response.statusText;
  response.headers.forEach((value, name) => {
    if (name !== 'set-cookie') res.setHeader(name, value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) res.setHeader('set-cookie', cookies);
  if (response.body === null) {
    res.end();
    return;
  }
  await pipeline(Readable.fromWeb(response.body), res);
}

// Runs a handler for a Node request and writes what it answers. A failure
// before anything is written answers 500; one after it cuts the connection.
export async function serve(
  handler: Handler,
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
): Promise<void> {
  try {
    await writeWebResponse(res, await handler(toWebRequest(req, url)));
  } catch {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.statusCode = 500;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('Internal error.');
  }
}
