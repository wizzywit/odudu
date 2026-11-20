import type { Session } from '#/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// The session an answer of the BFF's `session` route stands for: the claims of
// the signed-in person, or null for any answer that is not exactly that.
export function sessionOf(body: unknown): Session | null {
  if (!isRecord(body) || body.authenticated !== true) return null;
  const { claims } = body;
  return isRecord(claims) && typeof claims.sub === 'string' ? { claims } : null;
}
