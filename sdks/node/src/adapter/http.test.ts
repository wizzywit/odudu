import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { withToken } from '#/adapter/http';
import { type RunningApp, describeAdapterContract } from '#/testing/adapter-contract';

describeAdapterContract('node http', async (verifier) => {
  const errors: unknown[] = [];
  let handled = 0;
  const onError = (error: unknown): void => {
    errors.push(error);
  };
  const json = (res: ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const reports = withToken(
    verifier,
    (_req, res, auth) => {
      handled += 1;
      json(res, 200, { sub: auth.sub, scope: auth.scope });
    },
    { onError },
  );
  const reportsWrite = withToken(
    verifier,
    (_req, res) => {
      handled += 1;
      json(res, 200, { ok: true });
    },
    { scope: 'reports:write', onError },
  );
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path === '/reports') {
      reports(req, res);
      return;
    }
    if (path === '/reports-write') {
      reportsWrite(req, res);
      return;
    }
    json(res, 200, { ok: true });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const running: RunningApp = {
    origin: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`,
    errors,
    handled: () => handled,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
  return running;
});
