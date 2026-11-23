import { NextResponse } from 'next/server.js';

export function pass(): NextResponse {
  return NextResponse.next();
}

// `NextResponse.redirect` takes an absolute URL, so the path is resolved
// against the request's own origin.
export function redirectToPath(path: string, request: Request): NextResponse {
  return NextResponse.redirect(new URL(path, request.url));
}
