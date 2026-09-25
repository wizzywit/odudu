/**
 * SQLSTATE 23505, whatever depth the driver's error is wrapped at: Drizzle
 * wraps postgres.js's error, so the code is a level down from the error a
 * caller catches. One predicate for every writer that turns a unique index
 * into an answer of its own rather than letting it escape as a 500.
 */
export function isUniqueViolation(error: unknown): boolean {
  return hasSqlState(error, '23505');
}

/** SQLSTATE 23514, read the same way: a CHECK a caller can be answered about. */
export function isCheckViolation(error: unknown): boolean {
  return hasSqlState(error, '23514');
}

// The walk does not stop at the first `code` it meets: a wrapper carrying one
// of its own would otherwise mask the violation nested under it, and the
// answerable 400 escapes as a 500 instead.
function hasSqlState(error: unknown, sqlstate: string): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ('code' in error) {
    const { code }: { code: unknown } = error;
    if (code === sqlstate) return true;
  }
  return 'cause' in error && hasSqlState(error.cause, sqlstate);
}
