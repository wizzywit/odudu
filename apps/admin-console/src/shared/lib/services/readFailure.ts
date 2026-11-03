import type { GatewayFailure } from '#/shared/lib/services/result';

// Thrown by a query's read so that a failed one leaves what was already
// read in place, and the failure survives to be shown.
export class ReadFailure extends Error {
  readonly failure: GatewayFailure;
  constructor(failure: GatewayFailure) {
    super('a read failed');
    this.failure = failure;
  }
}

export function readFailureOf(error: unknown): GatewayFailure | null {
  return error instanceof ReadFailure ? error.failure : null;
}
