export interface ClaimedLogoutDelivery {
  readonly id: string;
  readonly endpoint: string;
  readonly logoutToken: string;
}

export interface LogoutDeliveryResponse {
  readonly status: number;
}

/**
 * Posts one Logout Token and resolves with the relying party's response, or
 * rejects for anything that never produced one — a connection failure, or
 * `signal` firing first. Never rejects for an HTTP error status; that is a
 * response, and `sendLogouts` classifies it as one.
 */
export type LogoutDeliveryTransport = (
  endpoint: string,
  logoutToken: string,
  signal: AbortSignal,
) => Promise<LogoutDeliveryResponse>;

export interface SendLogoutsDeps {
  claimDue(now: Date): Promise<readonly ClaimedLogoutDelivery[]>;
  /** Reports whether this call is the one that recorded the delivery. */
  markDelivered(id: string, now: Date): Promise<boolean>;
  /** A recoverable failure: offered again after a backoff. */
  markFailed(id: string, now: Date, error: string): Promise<void>;
  /** An unrecoverable failure: never offered again (OIDC Back-Channel Logout §2.5). */
  markAbandoned(id: string, now: Date, error: string): Promise<void>;
  readonly transport: LogoutDeliveryTransport;
  /**
   * Bounds one delivery end to end. A relying party that accepts the
   * connection and never answers is abandoned for this pass, not for good —
   * the row is still due, by `markFailed`'s own backoff, for the next one.
   */
  readonly responseTimeoutMs: number;
}

export interface SendLogoutsOutcome {
  readonly delivered: number;
  readonly failed: number;
}

// §2.8 gives the relying party exactly two responses to a Logout Token: 200
// for a successful logout, 400 for one it refuses. A 400 is the relying
// party rejecting this token deterministically, so sending the same token
// again would repeat a request already refused — §2.5's second SHOULD.
// Everything else this pass ever sees — a 503, any other status, a
// connection error, or this delivery's own deadline firing — is read as the
// first SHOULD's "may have failed recoverably" and gets a retry.
function isUnrecoverable(status: number): boolean {
  return status >= 400 && status < 500;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function deliverOne(
  deps: SendLogoutsDeps,
  row: ClaimedLogoutDelivery,
  now: Date,
): Promise<'delivered' | 'failed'> {
  const signal = AbortSignal.timeout(deps.responseTimeoutMs);
  try {
    const response = await deps.transport(row.endpoint, row.logoutToken, signal);
    if (response.status >= 200 && response.status < 300) {
      await deps.markDelivered(row.id, now);
      return 'delivered';
    }
    const status = String(response.status);
    if (isUnrecoverable(response.status)) {
      await deps.markAbandoned(row.id, now, `logout delivery refused with status ${status}`);
    } else {
      await deps.markFailed(row.id, now, `logout delivery failed with status ${status}`);
    }
    return 'failed';
  } catch (err) {
    await deps.markFailed(row.id, now, describeError(err));
    return 'failed';
  }
}

/**
 * Claims every delivery due, hands each to the transport in turn, and
 * marks the outcome. Takes its `now` as an argument and holds no timer, so
 * it runs identically from a command and from the server's own schedule
 * (ADR 0024). One relying party's failure — including one that never
 * answers, bounded by `responseTimeoutMs` — is resolved and the pass moves
 * on to the next row; nothing here waits on more than one delivery at once.
 */
export async function sendLogouts(deps: SendLogoutsDeps, now: Date): Promise<SendLogoutsOutcome> {
  const claimed = await deps.claimDue(now);

  let delivered = 0;
  let failed = 0;

  for (const row of claimed) {
    const outcome = await deliverOne(deps, row, now);
    if (outcome === 'delivered') delivered += 1;
    else failed += 1;
  }

  return { delivered, failed };
}
