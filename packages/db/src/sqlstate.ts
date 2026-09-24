/**
 * SQLSTATE 23505, whatever depth the driver's error is wrapped at: Drizzle
 * wraps postgres.js's error, so the code is a level down from the error a
 * caller catches. One predicate for every writer that turns a unique index
 * into an answer of its own rather than letting it escape as a 500.
 */
export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ('code' in error) {
    const { code }: { code: unknown } = error;
    if (code === '23505') return true;
  }
  return 'cause' in error && isUniqueViolation(error.cause);
}
