import type { ZodType } from 'zod';
import { isPrincipalChanged, isSessionEnded } from '#/shared/service/sessionEnded';
import { createSessionEvents, type SessionEvents } from '#/shared/service/sessionEvents';
import { nextCursor } from '#/shared/transport/cursor';
import { readEtag } from '#/shared/transport/etag';
import { readProblem } from '#/shared/transport/problem';
import type { GatewayFailure, GatewayResult, GatewaySuccess } from '#/shared/service/result';

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export interface RequestOptions<T> {
  body?: unknown;
  // A file sent as the body in place of JSON, under its own media type.
  file?: Blob;
  // The write carries no If-Match on purpose, as a first write to a resource
  // that has no ETag yet, so a 428 is the server's answer and not a console defect.
  withoutTag?: boolean;
  ifMatch?: string;
  // `*` on a create: the write is refused with 412 if the resource now exists.
  ifNoneMatch?: string;
  schema: ZodType<T>;
}

export type { GatewayFailure, GatewayResult, GatewaySuccess };

// A body answered as the server sent it, for a file the console saves
// rather than a document it reads: a schema would drop what it does not know.
export interface RawBody {
  text: string;
  contentType: string | null;
}

// A body answered as bytes, for a file the console shows rather than saves,
// such as an image: reading it as text would damage it.
export interface RawBytes {
  bytes: Uint8Array;
  contentType: string | null;
}

export interface Gateway {
  request<T>(method: Method, path: string, options: RequestOptions<T>): Promise<GatewayResult<T>>;
  download(method: 'GET', path: string): Promise<GatewayResult<RawBody>>;
  bytes(method: 'GET', path: string): Promise<GatewayResult<RawBytes>>;
  // The subject this tab shows as signed in, named on every admin request so
  // the gateway refuses one a sign-in in another tab has made somebody else's.
  believe(subjectId: string | null): void;
}

export interface GatewayDependencies {
  fetch?: Fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
  events?: SessionEvents;
  timeoutMs?: number;
}

// Where the console's own origin answers for the gateway: what a page links
// to or frames, such as the theme preview, begins here.
export const GATEWAY_BASE = '/console/api/';
const BASE = GATEWAY_BASE;
const ADMIN = 'admin/';
const SUBJECT_HEADER = 'x-odudu-console-subject';
const BACKOFF_MS = 250;
const DEFAULT_TIMEOUT_MS = 30_000;
// Not 502: the gateway sends that for a token-endpoint failure or after
// already waiting out a refresh lock, so a retry only stacks the delay.
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([503, 504]);

// A GET is safe to repeat. A PATCH or PUT is repeated only with If-Match,
// which makes a duplicate of one that did land answer 412, and only when no
// answer came back, since any status is the server's answer. A POST, a
// DELETE, or a write without If-Match whose outcome is unknown is never
// repeated; the caller says it could not confirm the result.
function retriesFor(method: Method, conditional: boolean): { attempts: number; onStatus: boolean } {
  if (method === 'GET') return { attempts: 3, onStatus: true };
  if ((method === 'PATCH' || method === 'PUT') && conditional) {
    return { attempts: 2, onStatus: false };
  }
  return { attempts: 1, onStatus: false };
}

interface Answer {
  response: Response;
  text: string;
  // Only for a call that asked for bytes.
  bytes?: Uint8Array;
}

// Resolved the way the browser will resolve it, so that dot segments in any
// spelling (`..`, `%2e%2e`, `.%2E`) and `\` cannot step out of the prefix.
function resolve(path: string): URL {
  const origin = globalThis.location.origin;
  const url = new URL(`${BASE}${path}`, origin);
  if (
    path.startsWith('/') ||
    path.includes('\\') ||
    url.origin !== origin ||
    !url.pathname.startsWith(BASE)
  ) {
    throw new TypeError(`a gateway path is relative to ${BASE} and stays under it, not "${path}"`);
  }
  return url;
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
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
  const events = dependencies.events ?? createSessionEvents();
  const timeoutMs = dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let believed: string | null = null;

  function emit(name: 'sessionEnded' | 'principalChanged'): void {
    try {
      events.emit(name);
    } catch (error) {
      log(`a ${name} subscriber threw: ${String(error)}`);
    }
  }

  // The timeout covers the body as well as the headers, so a response that
  // stalls halfway is a network failure rather than a request that never ends.
  async function attempt(url: string, init: RequestInit, binary: boolean): Promise<Answer | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    try {
      const response = await fetchResponse(url, { ...init, signal: controller.signal });
      if (!binary) return { response, text: await response.text() };
      const bytes = new Uint8Array(await response.arrayBuffer());
      // A refusal is a problem document and is read as text; a success is not.
      return { response, text: response.ok ? '' : new TextDecoder().decode(bytes), bytes };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function send(
    method: Method,
    conditional: boolean,
    url: string,
    init: RequestInit,
    binary: boolean,
  ): Promise<Answer | null> {
    const policy = retriesFor(method, conditional);
    for (let tried = 1; ; tried += 1) {
      const answer = await attempt(url, init, binary);
      const retryable =
        answer === null || (policy.onStatus && RETRYABLE_STATUSES.has(answer.response.status));
      if (!retryable || tried >= policy.attempts) return answer;
      await sleep(BACKOFF_MS * 2 ** (tried - 1));
    }
  }

  // Everything but reading a successful body: the headers every request
  // carries, the retries, and what a refusal tells the rest of the console.
  async function exchange(
    method: Method,
    path: string,
    options: {
      body?: unknown;
      file?: Blob;
      ifMatch?: string;
      ifNoneMatch?: string;
      withoutTag?: boolean;
      binary?: boolean;
    },
  ): Promise<{ ok: true; answer: Answer; where: string } | GatewayFailure> {
    const url = resolve(path);
    const where = `${method} ${url.pathname.slice(BASE.length)}`;
    const headers = new Headers({ accept: 'application/json' });
    if (method !== 'GET') headers.set('x-odudu-console', '1');
    if (options.ifMatch !== undefined) headers.set('if-match', options.ifMatch);
    if (options.ifNoneMatch !== undefined) headers.set('if-none-match', options.ifNoneMatch);
    if (believed !== null && path.startsWith(ADMIN)) headers.set(SUBJECT_HEADER, believed);
    const init: RequestInit = { method, headers, credentials: 'same-origin' };
    if (options.body !== undefined) {
      headers.set('content-type', 'application/json');
      init.body = JSON.stringify(options.body);
    }
    if (options.file !== undefined) {
      headers.set('content-type', options.file.type);
      init.body = options.file;
    }

    const answer = await send(
      method,
      options.ifMatch !== undefined || options.ifNoneMatch !== undefined,
      `${url.pathname}${url.search}`,
      init,
      options.binary === true,
    );
    if (answer === null) return { ok: false, kind: 'network' };
    const { response, text } = answer;

    if (!response.ok) {
      if (response.status === 428 && options.withoutTag !== true) {
        log(`console defect: ${where} answered 428: the server required If-Match`);
        return { ok: false, kind: 'defect' };
      }
      const problem = readProblem(response.status, response.headers.get('content-type'), text);
      if (isSessionEnded(problem)) emit('sessionEnded');
      if (isPrincipalChanged(problem)) emit('principalChanged');
      return { ok: false, kind: 'problem', problem };
    }
    return { ok: true, answer, where };
  }

  return {
    async request<T>(method: Method, path: string, options: RequestOptions<T>) {
      const exchanged = await exchange(method, path, options);
      if (!exchanged.ok) return exchanged;
      const { answer, where } = exchanged;
      const { response, text } = answer;

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
    async download(method, path) {
      const exchanged = await exchange(method, path, {});
      if (!exchanged.ok) return exchanged;
      const { response, text } = exchanged.answer;
      return {
        ok: true,
        status: response.status,
        data: { text, contentType: response.headers.get('content-type') },
        etag: readEtag(response.headers),
        next: null,
      };
    },
    async bytes(method, path) {
      const exchanged = await exchange(method, path, { binary: true });
      if (!exchanged.ok) return exchanged;
      const { response, bytes } = exchanged.answer;
      return {
        ok: true,
        status: response.status,
        data: {
          bytes: bytes ?? new Uint8Array(),
          contentType: response.headers.get('content-type'),
        },
        etag: null,
        next: null,
      };
    },
    believe(subjectId) {
      believed = subjectId;
    },
  };
}
