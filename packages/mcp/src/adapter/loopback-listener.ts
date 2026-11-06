import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { LoopbackListener } from '#/service/ports';
import { StdioError } from '#/service/stdio-error';

export interface LoopbackOptions {
  readonly timeoutMs: number;
}

const DONE_PAGE =
  '<!doctype html><meta charset="utf-8"><title>Odudu</title>' +
  '<p>You can close this tab and return to your editor.</p>';

const PAGE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'",
  'x-content-type-options': 'nosniff',
  connection: 'close',
} as const;

const ignore = (): void => undefined;

// Why a request is not the redirect, or nothing when it is.
function refusalOf(
  req: IncomingMessage,
  port: number,
  consumed: boolean,
): { readonly status: number } | undefined {
  if (req.headers.host !== `127.0.0.1:${String(port)}`) return { status: 421 };
  if (req.method !== 'GET') return { status: 405 };
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.pathname !== '/' || consumed) return { status: 404 };
  if (!url.searchParams.has('state')) return { status: 400 };
  return undefined;
}

function refuse(res: ServerResponse, status: number): void {
  res.writeHead(status, { 'content-length': '0', connection: 'close' });
  res.end();
}

// Waits for the redirect of one sign-in. It binds the IPv4 loopback address
// only, which is what the redirect URI names, answers the first GET at `/`
// that carries a `state` and then stops listening, and says nothing of what
// the request carried: the page is fixed. A request for another path, with no
// `state` or from another Host (a rebound name) is refused and leaves the
// listener waiting.
export async function listenOnLoopback(options: LoopbackOptions): Promise<LoopbackListener> {
  let finish: (params: URLSearchParams) => void = () => undefined;
  let fail: (error: StdioError) => void = () => undefined;
  const callback = new Promise<URLSearchParams>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  // A close nobody waited on is not an unhandled rejection.
  callback.catch(() => undefined);

  let consumed = false;
  let port = 0;
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const refusal = refusalOf(req, port, consumed);
    if (refusal !== undefined) {
      refuse(res, refusal.status);
      return;
    }
    consumed = true;
    res.writeHead(200, PAGE_HEADERS);
    res.end(DONE_PAGE, () => {
      finish(new URL(req.url ?? '/', 'http://127.0.0.1').searchParams);
      closed().catch(ignore);
    });
  });

  let closing: Promise<void> | undefined;
  const closed = (): Promise<void> => {
    closing ??= new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
      server.closeAllConnections();
    });
    return closing;
  };

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });
  port = (server.address() as AddressInfo).port;

  const timer = setTimeout(() => {
    fail(
      new StdioError(
        'mcp_login_timeout',
        'the sign-in was not completed in time; run the command again',
      ),
    );
    closed().catch(ignore);
  }, options.timeoutMs);
  timer.unref();

  return {
    redirectUri: `http://127.0.0.1:${String(port)}/`,
    callback,
    close: async () => {
      clearTimeout(timer);
      fail(new StdioError('mcp_login_cancelled', 'the sign-in was cancelled'));
      await closed();
    },
  };
}
