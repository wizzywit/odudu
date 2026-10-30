import type { GatewayFailure, GatewayResult } from '#/shared/service/result';

// What a write that returns the part of its answer worth keeping settled with.
export type Settled<Rest> = { ok: true; rest: Rest } | { ok: false; failure: GatewayFailure };

export function restOf<Rest>(settled: Settled<Rest> | undefined): Rest | null {
  return settled?.ok === true ? settled.rest : null;
}

export function failureOfSettled<Rest>(settled: Settled<Rest> | undefined): GatewayFailure | null {
  return settled?.ok === false ? settled.failure : null;
}

// What a read answered, nothing until it has answered or when it was refused.
export function dataOf<T>(result: GatewayResult<T> | undefined): T | undefined {
  return result?.ok === true ? result.data : undefined;
}

// The refusal in a write's answer, nothing while it has not answered.
export function failureOf(result: GatewayResult<unknown> | undefined): GatewayFailure | null {
  return result === undefined || result.ok ? null : result;
}

// Hands a write's refusal to `report`; a write that went through reports nothing.
export function reportFailure(
  result: GatewayResult<unknown>,
  report: (failure: GatewayFailure) => void,
): void {
  const failure = failureOf(result);
  if (failure !== null) report(failure);
}
