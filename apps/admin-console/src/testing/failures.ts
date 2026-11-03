import type { GatewayFailure } from '#/shared/lib/services/result';

export const failure = (kind: 'network' | 'schema' | 'defect'): GatewayFailure => ({
  ok: false,
  kind,
});

export const refusal = (
  status: number,
  extra: { type?: string; detail?: string; errors?: { path: string; message: string }[] } = {},
): GatewayFailure => ({
  ok: false,
  kind: 'problem',
  problem: { type: 'about:blank', title: `T${String(status)}`, status, ...extra },
});

export const refusedWith = (status: number, detail?: string, type = 'about:blank') =>
  ({ ok: false, kind: 'problem', problem: { type, title: 'Refused', status, detail } }) as const;
