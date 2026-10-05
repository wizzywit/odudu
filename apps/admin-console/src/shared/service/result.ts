import type { ProblemDetails } from '@odudu/contracts/admin';

// The gateway's own refusals and the admin API's forwarded ones share this
// shape; `detail` is absent from some (the gateway's 502 has none).
export type Problem = Omit<ProblemDetails, 'instance'> & { instance?: string | undefined };

export interface GatewaySuccess<T> {
  ok: true;
  status: number;
  data: T;
  etag: string | null;
  next: string | null;
}

// `defect` and `schema` are the console's own mistakes, already logged: a
// view reports them as a generic failure, never as something the user did.
export type GatewayFailure =
  | { ok: false; kind: 'problem'; problem: Problem }
  | { ok: false; kind: 'network' }
  | { ok: false; kind: 'schema' }
  | { ok: false; kind: 'defect' };

export type GatewayResult<T> = GatewaySuccess<T> | GatewayFailure;
