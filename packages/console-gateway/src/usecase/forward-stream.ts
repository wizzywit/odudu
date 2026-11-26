import { type Readable } from 'node:stream';
import { passedResponseHeaders, type PassedHeaders } from '#/service/rewrite';
import {
  endIfRefused,
  prepareCall,
  upstreamHeaders,
  type ConsoleAdminCall,
  type ForwardDeps,
  type Refusal,
} from '#/usecase/forward';

export interface ConsoleStreamCall extends ConsoleAdminCall {
  /** Fires when the browser goes: the upstream response is then destroyed. */
  readonly signal: AbortSignal;
}

export type ForwardStreamResult =
  | Refusal
  | {
      readonly kind: 'streaming';
      readonly status: number;
      readonly headers: PassedHeaders;
      readonly body: Readable;
    };

// A sibling of `forwardAdminCall` for the one kind of admin response that is
// read as it is written. The session, the principal check and the token are
// the same steps; the body is not buffered, so it has no size bound here (a
// turn's is bounded by its step cap) and no retry, and a 401 is settled on the
// status line before the first chunk is piped. When the browser goes, the
// upstream response is destroyed, which is what tells its handler to stop.
export async function forwardAdminStream(
  deps: ForwardDeps,
  call: ConsoleStreamCall,
): Promise<ForwardStreamResult> {
  const prepared = await prepareCall(deps, call);
  if (prepared.kind !== 'ready') return prepared;

  const upstream = await deps.odudu.forwardStream(
    {
      method: call.method,
      path: call.path,
      headers: upstreamHeaders(call, prepared.accessToken),
      body: call.body,
      from: call.from,
    },
    call.signal,
  );
  call.signal.addEventListener('abort', upstream.destroy, { once: true });
  if (call.signal.aborted) upstream.destroy();
  const ended = await endIfRefused(deps, prepared, upstream.status, call.from);
  if (ended !== null) {
    upstream.destroy();
    return ended;
  }
  return {
    kind: 'streaming',
    status: upstream.status,
    headers: passedResponseHeaders(upstream.headers),
    body: upstream.body,
  };
}
