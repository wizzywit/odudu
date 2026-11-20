import express, { type NextFunction } from 'express';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { KeyFetchError } from '#/services/verification-error';
import { authOf, requireToken } from '#/adapter/express';
import { type RunningApp, describeAdapterContract } from '#/testing/adapter-contract';

describeAdapterContract('express', async (verifier) => {
  const errors: unknown[] = [];
  let handled = 0;
  const app = express();
  const reply = (req: express.Request, res: express.Response): void => {
    handled += 1;
    const auth = authOf(req);
    res.json({ sub: auth.sub, scope: auth.scope });
  };
  app.get('/open', (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/reports', requireToken(verifier), reply);
  app.get('/reports-write', requireToken(verifier, { scope: 'reports:write' }), reply);
  app.use((error: unknown, _req: express.Request, res: express.Response, next: NextFunction) => {
    errors.push(error);
    if (res.headersSent) {
      next(error);
      return;
    }
    res.status(500).json({ error: 'server_error' });
  });
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => {
      resolve(s);
    });
  });
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

describe('express failure routing', () => {
  it('sends a failure while answering to next(err), with no unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const listener = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', listener);
    try {
      const failure = new Error('socket gone');
      const middleware = requireToken(() => Promise.reject(new KeyFetchError('down')));
      const next = await new Promise<unknown>((resolve) => {
        middleware(
          { headers: { authorization: 'Bearer abc' } },
          {
            statusCode: 200,
            headersSent: false,
            setHeader: () => {
              throw failure;
            },
            end: () => undefined,
          },
          resolve,
        );
      });
      await new Promise((resolve) => setImmediate(resolve));
      expect(next).toBe(failure);
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', listener);
    }
  });
});
