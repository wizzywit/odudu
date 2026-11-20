const MAX_TEXT = 1000;
const MAX_FIELD_ERRORS = 100;

export interface FieldError {
  path: string;
  message: string;
  code?: string;
  detail?: string;
  line?: number | null;
  column?: number | null;
}

export interface ProblemInit {
  status: number;
  code: string | undefined;
  title: string | undefined;
  detail: string | undefined;
  type: string | undefined;
  instance: string | undefined;
  errors: FieldError[];
}

/**
 * Raised for every response that is not a success. `code` is the part after `#`
 * of the problem `type` (`about:blank#idempotency-in-progress`), or the `error`
 * of a me API refusal.
 */
export class ProblemError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly title: string | undefined;
  readonly detail: string | undefined;
  readonly type: string | undefined;
  readonly instance: string | undefined;
  readonly errors: FieldError[];
  readonly response: Response;

  constructor(init: ProblemInit, response: Response) {
    super(messageOf(init));
    this.name = 'ProblemError';
    this.status = init.status;
    this.code = init.code;
    this.title = init.title;
    this.detail = init.detail;
    this.type = init.type;
    this.instance = init.instance;
    this.errors = init.errors;
    this.response = response;
  }
}

function messageOf(init: ProblemInit): string {
  const reason = init.detail ?? init.title ?? init.code;
  return reason === undefined
    ? `HTTP ${String(init.status)}`
    : `HTTP ${String(init.status)}: ${reason}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, MAX_TEXT) : undefined;
}

function codeOfType(type: string | undefined): string | undefined {
  const at = type?.indexOf('#') ?? -1;
  return type === undefined || at < 0 ? undefined : text(type.slice(at + 1));
}

function fieldError(value: unknown): FieldError | undefined {
  if (!isRecord(value)) return undefined;
  const path = text(value.path);
  const message = text(value.message);
  if (path === undefined || message === undefined) return undefined;
  const entry: FieldError = { path, message };
  const code = text(value.code);
  const detail = text(value.detail);
  if (code !== undefined) entry.code = code;
  if (detail !== undefined) entry.detail = detail;
  for (const key of ['line', 'column'] as const) {
    const position = value[key];
    if (typeof position === 'number' || position === null) entry[key] = position;
  }
  return entry;
}

function fieldErrors(value: unknown): FieldError[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_FIELD_ERRORS)
    .map(fieldError)
    .filter((entry) => entry !== undefined);
}

/**
 * Reads what a problem body (RFC 9457) or a me API refusal says. A body that is
 * neither, such as a proxy's error page, contributes nothing but the status, so
 * its text is never echoed.
 */
export function problemFromBody(status: number, body: string | undefined): ProblemInit {
  let parsed: unknown;
  try {
    parsed = body === undefined ? undefined : JSON.parse(body);
  } catch {
    parsed = undefined;
  }
  const empty: ProblemInit = {
    status,
    code: undefined,
    title: undefined,
    detail: undefined,
    type: undefined,
    instance: undefined,
    errors: [],
  };
  if (!isRecord(parsed)) return empty;
  const type = text(parsed.type);
  return {
    status,
    type,
    code: codeOfType(type) ?? text(parsed.error),
    title: text(parsed.title),
    detail: text(parsed.detail) ?? text(parsed.error_description),
    instance: text(parsed.instance),
    errors: fieldErrors(parsed.errors),
  };
}
