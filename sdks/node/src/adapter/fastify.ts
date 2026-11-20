import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { checkScope } from '#/services/configuration';
import { authenticate } from '#/use-cases/authenticate';
import type { VerifiedToken, Verifier } from '#/types';

export interface OduduAuthOptions {
  verifier: Verifier;
}

export interface RequireTokenOptions {
  // A scope the route needs; without it the route answers 403.
  scope?: string;
}

type TokenHook = (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<FastifyReply | undefined>;

declare module 'fastify' {
  interface FastifyRequest {
    // The verified token, set by the hook `requireToken` returns.
    auth: VerifiedToken | null;
  }
  interface FastifyInstance {
    // An `onRequest` hook that lets a request through only with a verified token.
    requireToken: (options?: RequireTokenOptions) => TokenHook;
  }
}

const plugin: FastifyPluginAsync<OduduAuthOptions> = (app, { verifier }) => {
  app.decorateRequest('auth', null);
  app.decorate('requireToken', (options: RequireTokenOptions = {}): TokenHook => {
    if (options.scope !== undefined) checkScope(options.scope, 'scope');
    return async (request, reply) => {
      const outcome = await authenticate(
        verifier,
        { headers: request.headers, rawHeaders: request.raw.rawHeaders },
        options.scope,
      );
      if ('refusal' in outcome) {
        const { status, headers, body } = outcome.refusal;
        return reply.code(status).headers(headers).send(body);
      }
      request.auth = outcome.auth;
      return undefined;
    };
  });
  return Promise.resolve();
};

// Registers `request.auth` and `app.requireToken()`. Without encapsulation:
// what it adds is visible to the whole app, as with `fastify-plugin`.
export const oduduAuth: FastifyPluginAsync<OduduAuthOptions> = Object.assign(plugin, {
  [Symbol.for('skip-override')]: true,
});
