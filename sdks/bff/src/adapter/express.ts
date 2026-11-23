import { Router, type Request, type Response } from 'express';
import { routesOf } from '#/adapter/routes';
import { serve, type ErrorHook } from '#/adapter/node-bridge';
import type { Bff } from '#/types';

export interface BffRouterOptions {
  // Put before `/login`, `/callback`, `/logout` and `/session`; the `mountPath`
  // of the BFF when omitted. The proxy is mounted at the `proxyPath` of the BFF.
  prefix?: string;
  // Called with the error of a handler that failed and was answered `500`, so a
  // store outage reaches your logs. It gets the error alone, never the request.
  onError?: ErrorHook;
}

// The BFF's routes as an Express router. Mount it before any body parser: the
// BFF reads the request as a stream, and a parser that ran first would have
// taken the body.
export function bffRouter(bff: Bff, options: BffRouterOptions = {}): Router {
  const router = Router();
  for (const route of routesOf(bff, options.prefix ?? bff.mountPath)) {
    const handle = (req: Request, res: Response): Promise<void> =>
      serve(route.handler, req, res, req.originalUrl, options.onError);
    router.all(route.path, handle);
    if (route.below) router.all(`${route.path}/*splat`, handle);
  }
  return router;
}
