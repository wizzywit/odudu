import { vi } from 'vitest';
import { createSessionEvents } from '#/shared/service/sessionEvents.ts';
import { createAuth } from '#/shared/transport/auth.ts';
import { createGateway, type Fetch } from '#/shared/transport/gateway.ts';
import type { Transport } from '#/shared/transport/transport.ts';

export type Answer = () => Response | Promise<Response>;

export function json(body: unknown, status = 200): Answer {
  return () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
}

export function problem(status: number, type = 'about:blank', title = 'Refused'): Answer {
  return () =>
    new Response(JSON.stringify({ type, title, status }), {
      status,
      headers: { 'content-type': 'application/problem+json' },
    });
}

export const SESSION_ENDED = problem(401, 'about:blank#console-session-ended', 'Unauthorized');

// An answer that never comes, for a page caught while it waits.
export function pending(): Answer {
  return () => new Promise<Response>(() => undefined);
}

export function offline(): Answer {
  return () => {
    throw new TypeError('Failed to fetch');
  };
}

export interface Call {
  readonly method: string;
  readonly path: string;
  // The X-Odudu-Console-Subject the request named, or null.
  readonly subject: string | null;
}

// A gateway that answers from a table keyed by `METHOD /path` (query left
// out), and records what was asked of it. Anything unlisted is a 404.
export function fakeTransport(routes: Record<string, Answer>) {
  const calls: Call[] = [];
  const answerFor: Fetch = (url, init) => {
    const method = init.method ?? 'GET';
    const path = new URL(url, 'http://gateway.invalid').pathname;
    calls.push({ method, path, subject: new Headers(init.headers).get('x-odudu-console-subject') });
    const answer = routes[`${method} ${path}`] ?? problem(404, 'about:blank', 'Not Found');
    try {
      return Promise.resolve(answer());
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  };
  const events = createSessionEvents();
  const leavePage = vi.fn<(url: string) => void>();
  const log = (): void => undefined;
  const transport: Transport = {
    gateway: createGateway({ fetch: answerFor, events, log, sleep: () => Promise.resolve() }),
    auth: createAuth({ fetch: answerFor, log }),
    events,
    leavePage,
  };
  return { transport, calls, leavePage, routes };
}
