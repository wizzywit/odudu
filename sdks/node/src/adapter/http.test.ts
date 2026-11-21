import { createServer, type ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
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

describe('node http when the error hook throws', () => {
  it('still answers with a 500 and ends the response', async () => {
    const wrapped = withToken(
      () => Promise.reject(new Error('the keys are on fire')),
      () => undefined,
      {
        onError: () => {
          throw new Error('the logger is down');
        },
      },
    );
    const server = createServer((req, res) => {
      wrapped(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
      const response = await fetch(origin, {
        headers: { authorization: 'Bearer abc' },
        signal: AbortSignal.timeout(2_000),
      });
      expect(response.status).toBe(500);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    }
  });
});
