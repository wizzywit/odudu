import { routesOf } from '#/adapter/routes';
import { serve } from '#/adapter/node-bridge';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Bff } from '#/types';

export interface RegisterBffOptions {
  // Put before `/login`, `/callback`, `/logout` and `/session`; none when
  // omitted. The proxy is mounted at the `proxyPath` of the BFF.
  prefix?: string;
}

// Mounts the BFF's routes on a Fastify app. The BFF answers from the raw
// request in an `onRequest` hook, before Fastify reads or parses any body, so a
// proxied body streams from the socket to the upstream untouched.
export function registerBff(
  app: FastifyInstance,
  bff: Bff,
  options: RegisterBffOptions = {},
): void {
  for (const route of routesOf(bff, options.prefix ?? '')) {
    const onRequest = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      reply.hijack();
      await serve(route.handler, request.raw, reply.raw, request.url);
    };
    app.all(route.path, { onRequest }, () => undefined);
    if (route.below) app.all(`${route.path}/*`, { onRequest }, () => undefined);
  }
}
