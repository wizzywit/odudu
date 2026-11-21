import { routesOf } from '#/adapter/routes';
import { serve, type ErrorHook } from '#/adapter/node-bridge';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Bff } from '#/types';

export interface RegisterBffOptions {
  // Put before `/login`, `/callback`, `/logout` and `/session`; the `mountPath`
  // of the BFF when omitted. The proxy is mounted at the `proxyPath` of the BFF.
  prefix?: string;
  // Called with the error of a handler that failed and was answered `500`. It
  // gets the error alone, never the request. Fastify's logger (`app.log.error`)
  // when omitted.
  onError?: ErrorHook;
}

// Mounts the BFF's routes on a Fastify app. The BFF answers from the raw
// request in an `onRequest` hook, before Fastify reads or parses any body, so a
// proxied body streams from the socket to the upstream untouched.
export function registerBff(
  app: FastifyInstance,
  bff: Bff,
  options: RegisterBffOptions = {},
): void {
  const onError: ErrorHook =
    options.onError ??
    ((error) => {
      app.log.error({ err: error }, 'the BFF failed to answer a request');
    });
  for (const route of routesOf(bff, options.prefix ?? bff.mountPath)) {
    const onRequest = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      reply.hijack();
      await serve(route.handler, request.raw, reply.raw, request.url, onError);
    };
    app.all(route.path, { onRequest }, () => undefined);
    if (route.below) app.all(`${route.path}/*`, { onRequest }, () => undefined);
  }
}
