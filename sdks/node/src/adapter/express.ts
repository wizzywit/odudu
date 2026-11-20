import { type NodeResponse, sendRefusal } from '#/adapter/node-response';
import { checkScope } from '#/services/configuration';
import { authenticate, type RequestHeaders } from '#/use-cases/authenticate';
import type { VerifiedToken, Verifier } from '#/types';

export type { NodeResponse, RequestHeaders };

export interface RequireTokenOptions {
  // A scope the route needs; without it the route answers 403.
  scope?: string;
}

// Express middleware: the request reaches the next handler only with a
// verified token, which `authOf(req)` returns and `req.auth` holds.
export function requireToken(
  verifier: Verifier,
  options: RequireTokenOptions = {},
): (
  req: RequestHeaders & { auth?: VerifiedToken },
  res: NodeResponse,
  next: (error?: unknown) => void,
) => void {
  if (options.scope !== undefined) checkScope(options.scope, 'scope');
  return (req, res, next) => {
    authenticate(verifier, req, options.scope)
      .then((outcome) => {
        if ('refusal' in outcome) {
          sendRefusal(res, outcome.refusal);
          return;
        }
        req.auth = outcome.auth;
        next();
      })
      .catch(next);
  };
}

// The token `requireToken` verified. Throws on a route that does not use it.
export function authOf(req: object): VerifiedToken {
  const { auth } = req as { auth?: VerifiedToken };
  if (auth === undefined)
    throw new Error('authOf was called on a request requireToken did not see');
  return auth;
}
