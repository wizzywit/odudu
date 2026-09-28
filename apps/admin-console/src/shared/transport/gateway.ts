import type { ZodType } from 'zod';
import { sessionEvents, type SessionEvents } from '#/shared/service/sessionEvents.ts';
import { nextCursor } from '#/shared/transport/cursor.ts';
import { readEtag } from '#/shared/transport/etag.ts';
import { isSessionEnded, readProblem, type Problem } from '#/shared/transport/problem.ts';

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export interface RequestOptions<T> {
  readonly body?: unknown;
  readonly ifMatch?: string;
  readonly schema: ZodType<T>;
}

export interface GatewaySuccess<T> {
  readonly ok: true;
  readonly status: number;
  readonly data: T;
  readonly etag: string | null;
  readonly next: string | null;
}

// `defect` and `schema` are the console's own mistakes, already logged: a
// view reports them as a generic failure, never as something the user did.
export type GatewayFailure =
  | { readonly ok: false; readonly kind: 'problem'; readonly problem: Problem }
  | { readonly ok: false; readonly kind: 'network' }
  | { readonly ok: false; readonly kind: 'schema' }
  | { readonly ok: false; readonly kind: 'defect' };

export type GatewayResult<T> = GatewaySuccess<T> | GatewayFailure;

export interface Gateway {
  request<T>(method: Method, path: string, options: RequestOptions<T>): Promise<GatewayResult<T>>;
}

export interface GatewayDependencies {
  readonly fetch?: Fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly log?: (message: string) => void;
  readonly events?: SessionEvents;
  readonly timeoutMs?: number;
}

const BASE = '/console/api/';
const BACKOFF_MS = 250;
const DEFAULT_TIMEOUT_MS = 30_000;
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);

// A GET is safe to repeat. A PATCH or PUT carries If-Match, so a duplicate of
// one that did land answers 412; it is repeated only when no answer came
// back, since any status is the server's answer and is shown as one. A POST
// or DELETE whose outcome is unknown is never repeated; the caller says it
// could not confirm the result.
function retriesFor(method: Method): { readonly attempts: number; readonly onStatus: boolean } {
  if (method === 'GET') return { attempts: 3, onStatus: true };
  if (method === 'PATCH' || method === 'PUT') return { attempts: 2, onStatus: false };
  return { attempts: 1, onStatus: false };
}

interface Answer {
  readonly response: Response;
  readonly text: string;
}

function withoutQuery(path: string): string {
  const end = path.search(/[?#]/);
  return end === -1 ? path : path.slice(0, end);
}

function parseJson(
  text: string,
): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  if (text === '') return { ok: true, value: undefined };
  try {
    const value: unknown = JSON.parse(text);
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

export function createGateway(dependencies: GatewayDependencies = {}): Gateway {
  const fetchResponse: Fetch = dependencies.fetch ?? ((url, init) => fetch(url, init));
  const sleep =
    dependencies.sleep ??
    ((ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }));
  const log =
    dependencies.log ??
    ((message: string) => {
      console.error(message);
    });
  const events = dependencies.events ?? sessionEvents;
  const timeoutMs = dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // The timeout covers the body as well as the headers, so a response that
  // stalls halfway is a network failure rather than a request that never ends.
  async function attempt(url: string, init: RequestInit): Promise<Answer | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    try {
      const response = await fetchResponse(url, { ...init, signal: controller.signal });
      return { response, text: await response.text() };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function send(method: Method, url: string, init: RequestInit): Promise<Answer | null> {
    const policy = retriesFor(method);
    for (let tried = 1; ; tried += 1) {
      const answer = await attempt(url, init);
      const retryable =
        answer === null || (policy.onStatus && RETRYABLE_STATUSES.has(answer.response.status));
      if (!retryable || tried >= policy.attempts) return answer;
      await sleep(BACKOFF_MS * 2 ** (tried - 1));
    }
  }

  return {
    async request<T>(method: Method, path: string, options: RequestOptions<T>) {
      if (path.startsWith('/')) {
        throw new TypeError(`a gateway path is relative to ${BASE}, not "${path}"`);
      }
      const where = `${method} ${withoutQuery(path)}`;
      const headers = new Headers({ accept: 'application/json' });
      if (method !== 'GET') headers.set('x-odudu-console', '1');
      if (options.ifMatch !== undefined) headers.set('if-match', options.ifMatch);
      const init: RequestInit = { method, headers, credentials: 'same-origin' };
      if (options.body !== undefined) {
        headers.set('content-type', 'application/json');
        init.body = JSON.stringify(options.body);
      }

      const answer = await send(method, `${BASE}${path}`, init);
      if (answer === null) return { ok: false, kind: 'network' };
      const { response, text } = answer;

      if (!response.ok) {
        if (response.status === 428) {
          log(`console defect: ${where} answered 428, so it was sent without If-Match`);
          return { ok: false, kind: 'defect' };
        }
        const problem = readProblem(response.status, response.headers.get('content-type'), text);
        if (isSessionEnded(problem)) {
          try {
            events.emit('sessionEnded');
          } catch (error) {
            log(`a sessionEnded subscriber threw: ${String(error)}`);
          }
        }
        return { ok: false, kind: 'problem', problem };
      }

      const json = parseJson(text);
      if (!json.ok) {
        log(
          `console defect: ${where} answered ${String(response.status)} with a body that is not JSON`,
        );
        return { ok: false, kind: 'schema' };
      }
      const parsed = options.schema.safeParse(json.value);
      if (!parsed.success) {
        const at = parsed.error.issues.map((issue) => issue.path.map(String).join('.') || '(root)');
        log(`console defect: ${where} answered a body its schema refuses at ${at.join(', ')}`);
        return { ok: false, kind: 'schema' };
      }
      return {
        ok: true,
        status: response.status,
        data: parsed.data,
        etag: readEtag(response.headers),
        next: nextCursor(response.headers.get('link')),
      };
    },
  };
}
