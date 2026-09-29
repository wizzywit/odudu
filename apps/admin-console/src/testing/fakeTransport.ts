import { vi } from 'vitest';
import { createSessionEvents } from '#/shared/service/sessionEvents.ts';
import { createAuth } from '#/shared/transport/auth.ts';
import { createGateway, type Fetch } from '#/shared/transport/gateway.ts';
import type { Transport } from '#/shared/transport/transport.ts';

export type Answer = () => Response | Promise<Response>;

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Answer {
  return () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
}

export function problem(
  status: number,
  type = 'about:blank',
  title = 'Refused',
  extra: { readonly detail?: string; readonly errors?: readonly unknown[] } = {},
): Answer {
  return () =>
    new Response(JSON.stringify({ type, title, status, ...extra }), {
      status,
      headers: { 'content-type': 'application/problem+json' },
    });
}

// Answers each request with the next of `answers`, then keeps giving the last.
export function inTurn(...answers: [Answer, ...Answer[]]): Answer {
  let given = 0;
  return () => {
    const answer = answers[Math.min(given, answers.length - 1)] ?? answers[0];
    given += 1;
    return answer();
  };
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

// What a request carried beyond its address: its query, If-Match and body.
export interface Sent {
  readonly method: string;
  readonly path: string;
  readonly search: URLSearchParams;
  readonly ifMatch: string | null;
  readonly body: unknown;
}

function bodyOf(init: RequestInit): unknown {
  if (typeof init.body !== 'string') return undefined;
  const parsed: unknown = JSON.parse(init.body);
  return parsed;
}

// A gateway that answers from a table keyed by `METHOD /path` (query left
// out), and records what was asked of it. Anything unlisted is a 404.
export function fakeTransport(routes: Record<string, Answer>) {
  const calls: Call[] = [];
  const sent: Sent[] = [];
  const answerFor: Fetch = (url, init) => {
    const method = init.method ?? 'GET';
    const address = new URL(url, 'http://gateway.invalid');
    const path = address.pathname;
    const headers = new Headers(init.headers);
    calls.push({ method, path, subject: headers.get('x-odudu-console-subject') });
    sent.push({
      method,
      path,
      search: address.searchParams,
      ifMatch: headers.get('if-match'),
      body: bodyOf(init),
    });
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
  return { transport, calls, sent, leavePage, routes };
}
