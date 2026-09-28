import { importErrorSchema, problemDetailsSchema } from '@odudu/contracts/admin';
import { z } from 'zod';

export const SESSION_ENDED_TYPE = 'about:blank#console-session-ended';

// The gateway's own refusals and the admin API's forwarded ones share this
// shape; `detail` is absent from some (the gateway's 502 has none).
const problemSchema = problemDetailsSchema.extend({
  instance: z.string().optional(),
  detail: z.string().optional(),
  errors: z.array(importErrorSchema).optional(),
});
export type Problem = z.infer<typeof problemSchema>;

const TITLES: Readonly<Record<number, string>> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  412: 'Precondition Failed',
  428: 'Precondition Required',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

function parseJson(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    return undefined;
  }
}

// A refusal that is not problem+json — a proxy's HTML page, say — still
// becomes a Problem, stood up from its status alone.
export function readProblem(status: number, contentType: string | null, text: string): Problem {
  const fallback: Problem = {
    type: 'about:blank',
    title: TITLES[status] ?? `HTTP ${String(status)}`,
    status,
  };
  if (contentType?.toLowerCase().startsWith('application/problem+json') !== true) return fallback;
  const parsed = problemSchema.safeParse(parseJson(text));
  return parsed.success ? { ...parsed.data, status } : fallback;
}

export function isSessionEnded(problem: Problem): boolean {
  return problem.status === 401 && problem.type === SESSION_ENDED_TYPE;
}
