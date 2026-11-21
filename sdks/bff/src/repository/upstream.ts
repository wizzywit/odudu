import { sendUpstream, type UpstreamCall, type UpstreamOutcome } from '#/adapter/upstream';
import type { BffConfig } from '#/services/config';

export interface Upstreams {
  forward(call: UpstreamCall): Promise<UpstreamOutcome>;
}

export function createUpstreams(config: BffConfig): Upstreams {
  const limits = {
    maxBodyBytes: config.maxBodyBytes,
    timeoutMs: config.upstreamTimeoutMs,
    idleMs: config.upstreamIdleMs,
    fetch: config.deps?.fetch ?? ((input, init) => fetch(input, init)),
  };
  return { forward: (call) => sendUpstream(call, limits) };
}
