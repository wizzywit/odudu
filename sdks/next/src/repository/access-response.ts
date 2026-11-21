import { pass, redirectToPath } from '#/adapter/next-server';
import type { NextRequest, NextResponse } from 'next/server.js';

// Lets the request on, or sends it to the path `signIn` makes. The path is made
// only when it is used.
export function answerAccess(
  verdict: 'pass' | 'sign-in',
  request: NextRequest,
  signIn: () => string,
): NextResponse {
  return verdict === 'pass' ? pass() : redirectToPath(signIn(), request);
}
