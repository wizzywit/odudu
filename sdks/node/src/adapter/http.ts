import type { IncomingMessage, ServerResponse } from 'node:http';
import { type NodeResponse, sendRefusal } from '#/adapter/node-response';
import { checkScope } from '#/services/configuration';
import { serverError } from '#/services/refusal';
import { authenticate, type RequestHeaders } from '#/use-cases/authenticate';
import type { VerifiedToken, Verifier } from '#/types';

export type { NodeResponse, RequestHeaders };

export interface WithTokenOptions {
  // A scope the route needs. A token that lacks it gets 403.
  scope?: string;
  // Told of an error that is not a refusal, to log it. The caller gets a bare 500.
  onError?: (error: unknown) => void;
}

// Wraps a handler for `http.createServer` so it runs only for a verified token.
export function withToken<
  Req extends RequestHeaders = IncomingMessage,
  Res extends NodeResponse = ServerResponse,
>(
  verifier: Verifier,
  handler: (req: Req, res: Res, auth: VerifiedToken) => void | Promise<void>,
  options: WithTokenOptions = {},
): (req: Req, res: Res) => void {
  if (options.scope !== undefined) checkScope(options.scope, 'scope');
  const run = async (req: Req, res: Res): Promise<void> => {
    try {
      const outcome = await authenticate(verifier, req, options.scope);
      if ('refusal' in outcome) sendRefusal(res, outcome.refusal);
      else await handler(req, res, outcome.auth);
    } catch (error) {
      // Whatever the hook does, the caller still gets an answer.
      try {
        options.onError?.(error);
      } finally {
        if (res.headersSent) res.end();
        else sendRefusal(res, serverError());
      }
    }
  };
  return (req, res) => {
    run(req, res).catch(() => undefined);
  };
}
